import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  WorkbenchValidationCheckPendingResultSchema,
  type WorkbenchValidationCheckPendingResult
} from '../../../../shared/rpc-contract/workbench-validation-params'
import { toWorkbenchError, type WorkbenchError } from './workbench-rpc-error'

const LOCAL = { kind: 'local' } as const

type CheckState = {
  checking: boolean
  result: WorkbenchValidationCheckPendingResult | null
  error: WorkbenchError | null
}

export type WorkbenchValidationCheckModel = CheckState & { check: () => Promise<void> }

// Why no local copy: the pass-running and unavailable refusals are worded in workbench-error-copy.
function checkError(error: unknown): WorkbenchError {
  return toWorkbenchError(error)
}

/** The user's "Check now": one backlog pass in main, which may run a reviewer CLI, so only on click. */
export function useWorkbenchValidationCheck(): WorkbenchValidationCheckModel {
  const [state, setState] = useState<CheckState>({ checking: false, result: null, error: null })
  const mountedRef = useRef(true)
  // Why a ref: the disabled button lags one render, and a double click must not start two passes.
  const inFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const check = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) {
      return
    }
    inFlightRef.current = true
    setState((previous) => ({ ...previous, checking: true }))
    let next: CheckState
    try {
      const raw = await callRuntimeRpc<unknown>(LOCAL, 'workbench.validation.checkPending', {})
      next = {
        checking: false,
        result: WorkbenchValidationCheckPendingResultSchema.parse(raw),
        error: null
      }
    } catch (error) {
      next = { checking: false, result: null, error: checkError(error) }
    } finally {
      inFlightRef.current = false
    }
    if (mountedRef.current) {
      setState(next)
    }
  }, [])

  return { ...state, check }
}

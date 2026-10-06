import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  WORKBENCH_VALIDATION_ERROR_CODES,
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

/** Known refusals get local copy; any other failure keeps the server's code and English text. */
function checkError(error: unknown): WorkbenchError {
  const shown = toWorkbenchError(error, {
    invalidResponse: translate(
      'workbench.validation.invalidResponse',
      'Validation returned an invalid response.'
    ),
    failed: translate('workbench.validation.failed', 'The validation check failed.')
  })
  switch (shown.code) {
    case WORKBENCH_VALIDATION_ERROR_CODES.passRunning:
      return {
        ...shown,
        message: translate(
          'workbench.validation.passRunning',
          'A validation pass is already running. Check again when it finishes.'
        )
      }
    case WORKBENCH_VALIDATION_ERROR_CODES.unavailable:
      return {
        ...shown,
        message: translate(
          'workbench.validation.unavailable',
          'Task validation is not available in this session.'
        )
      }
    default:
      return shown
  }
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

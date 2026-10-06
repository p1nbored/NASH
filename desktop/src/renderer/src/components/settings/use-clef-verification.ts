import { useCallback, useEffect, useRef, useState } from 'react'
import { useMountedRef } from '@/hooks/useMountedRef'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  ClefProfilePinResultSchema,
  ClefVerifyResultSchema,
  type ClefProfilePinResult,
  type ClefVerifyResult
} from '../../../../shared/clef/clef-verification-view'
import {
  WorkbenchRoutingStatusViewSchema,
  type WorkbenchRoutingStatusView
} from '../../../../shared/clef/workbench-routing-status-view'
import { clefVerificationCallErrorMessage } from './clef-verification-messages'

const LOCAL = { kind: 'local' } as const

export type ClefVerificationModel = {
  /** Null while loading or when the status could not be read; `statusError` then says why. */
  status: WorkbenchRoutingStatusView | null
  statusError: string | null
  loading: boolean
  running: 'verify' | 'pin' | null
  result: ClefVerifyResult | null
  pinned: ClefProfilePinResult | null
  error: string | null
  verify: () => Promise<void>
  pin: (reportSha256: string) => Promise<void>
}

/**
 * Status, Verify and Pin through the existing desktop RPC. Only flags, counts and hashes cross it:
 * the credential values never reach the renderer, and Verify sends no input at all.
 */
export function useClefVerification(): ClefVerificationModel {
  const mountedRef = useMountedRef()
  const requestRef = useRef(0)
  // Why: a disabled button can still fire twice before React re-renders; Verify and Pin share it.
  const busyRef = useRef(false)
  const [status, setStatus] = useState<WorkbenchRoutingStatusView | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<'verify' | 'pin' | null>(null)
  const [result, setResult] = useState<ClefVerifyResult | null>(null)
  const [pinned, setPinned] = useState<ClefProfilePinResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const request = ++requestRef.current
    let next: WorkbenchRoutingStatusView | null = null
    let failure: string | null = null
    try {
      const raw = await callRuntimeRpc<unknown>(LOCAL, 'workbench.routing.status', undefined)
      next = WorkbenchRoutingStatusViewSchema.parse(raw)
    } catch (caught) {
      failure = clefVerificationCallErrorMessage(caught)
    }
    if (mountedRef.current && request === requestRef.current) {
      setStatus(next)
      setStatusError(failure)
      setLoading(false)
    }
  }, [mountedRef])

  useEffect(() => {
    void load()
  }, [load])

  const verify = useCallback(async (): Promise<void> => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setRunning('verify')
    setError(null)
    setPinned(null)
    try {
      const raw = await callRuntimeRpc<unknown>(LOCAL, 'workbench.clef.verify', {})
      const parsed = ClefVerifyResultSchema.parse(raw)
      if (mountedRef.current) {
        setResult(parsed)
      }
    } catch (caught) {
      if (mountedRef.current) {
        setError(clefVerificationCallErrorMessage(caught))
      }
    }
    busyRef.current = false
    if (mountedRef.current) {
      setRunning(null)
    }
    await load()
  }, [load, mountedRef])

  const pin = useCallback(
    async (reportSha256: string): Promise<void> => {
      if (busyRef.current) {
        return
      }
      busyRef.current = true
      setRunning('pin')
      setError(null)
      try {
        const raw = await callRuntimeRpc<unknown>(LOCAL, 'workbench.clef.profile.pin', {
          reportSha256
        })
        const parsed = ClefProfilePinResultSchema.parse(raw)
        if (mountedRef.current) {
          setPinned(parsed)
        }
      } catch (caught) {
        if (mountedRef.current) {
          setError(clefVerificationCallErrorMessage(caught))
        }
      }
      busyRef.current = false
      if (mountedRef.current) {
        setRunning(null)
      }
      await load()
    },
    [load, mountedRef]
  )

  return { status, statusError, loading, running, result, pinned, error, verify, pin }
}

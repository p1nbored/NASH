import { useCallback, useEffect, useRef, useState } from 'react'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  parseClefCredentialStatus,
  parseClefCredentialsMutationResult,
  type ClefCredentialSaveInput,
  type ClefCredentialStatus,
  type ClefCredentialsMutationResult
} from '../../../../shared/clef/clef-credential-contract'
import {
  clefClearCallFailedMessage,
  clefClearedMessage,
  clefRefusalMessage,
  clefSaveCallFailedMessage,
  clefSavedMessage
} from './clef-credential-messages'

export type ClefCredentialsNotice = { kind: 'success' | 'error'; message: string }

export type ClefCredentialsModel = {
  /** Null while loading or when the status could not be read. */
  status: ClefCredentialStatus | null
  loading: boolean
  busy: boolean
  notice: ClefCredentialsNotice | null
  save: (input: ClefCredentialSaveInput) => Promise<void>
  clear: () => Promise<void>
}

type MutationCopy = { success: () => string; callFailed: () => string }

const SAVE_COPY: MutationCopy = { success: clefSavedMessage, callFailed: clefSaveCallFailedMessage }
const CLEAR_COPY: MutationCopy = {
  success: clefClearedMessage,
  callFailed: clefClearCallFailedMessage
}

/** Presence, protection and outcome codes only; the token passes through save and is not kept. */
export function useClefCredentials(): ClefCredentialsModel {
  const mountedRef = useMountedRef()
  const requestRef = useRef(0)
  // Why: a disabled button can still fire twice before React re-renders; save and clear share it.
  const busyRef = useRef(false)
  const [status, setStatus] = useState<ClefCredentialStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<ClefCredentialsNotice | null>(null)

  // Why the request counter: a slow status read must not overwrite a newer save or clear result.
  const applyStatus = useCallback(
    (request: number, next: ClefCredentialStatus | null): void => {
      if (mountedRef.current && request === requestRef.current) {
        setStatus(next)
        setLoading(false)
      }
    },
    [mountedRef]
  )

  const load = useCallback(async (): Promise<void> => {
    const request = ++requestRef.current
    let next: ClefCredentialStatus | null = null
    try {
      next = parseClefCredentialStatus(await window.api.clefCredentials.status())
    } catch {
      next = null
    }
    applyStatus(request, next)
  }, [applyStatus])

  useEffect(() => {
    void load()
  }, [load])

  const mutate = useCallback(
    async (call: () => Promise<unknown>, copy: MutationCopy): Promise<void> => {
      if (busyRef.current) {
        return
      }
      busyRef.current = true
      const request = ++requestRef.current
      setBusy(true)
      setNotice(null)
      let result: ClefCredentialsMutationResult | null = null
      try {
        result = parseClefCredentialsMutationResult(await call())
      } catch {
        // Why no detail: an IPC error message could quote the arguments it was given.
        result = null
      }
      busyRef.current = false
      if (!mountedRef.current) {
        return
      }
      setBusy(false)
      if (result === null) {
        setNotice({ kind: 'error', message: copy.callFailed() })
        void load()
        return
      }
      applyStatus(request, result.status)
      setNotice(
        result.ok
          ? { kind: 'success', message: copy.success() }
          : { kind: 'error', message: clefRefusalMessage(result.code) }
      )
    },
    [applyStatus, load, mountedRef]
  )

  const save = useCallback(
    (input: ClefCredentialSaveInput) =>
      mutate(() => window.api.clefCredentials.save(input), SAVE_COPY),
    [mutate]
  )
  const clear = useCallback(
    () => mutate(() => window.api.clefCredentials.clear(), CLEAR_COPY),
    [mutate]
  )

  return { status, loading, busy, notice, save, clear }
}

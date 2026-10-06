import { useCallback, useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import { useMountedRef } from '@/hooks/useMountedRef'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  WorkbenchDotRemotePairingStartResultSchema,
  WorkbenchDotRemoteRevokeResultSchema,
  WorkbenchDotRemoteStatusViewSchema,
  type WorkbenchDotRemotePairingView,
  type WorkbenchDotRemoteStatusView
} from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import {
  readDotRemotePairingView,
  reconcileDotRemotePairingView,
  useDotRemotePairingPoll
} from './dot-remote-pairing-poll'
import { dotRemoteCallErrorMessage } from './dot-remote-refusal-messages'

const LOCAL = { kind: 'local' } as const

/** Which part of the card a pending change or a refusal belongs to. */
export type DotRemoteScope = 'switch' | 'connection' | 'pairing' | 'revoke'

export type DotRemoteRefusal = { scope: DotRemoteScope; message: string }

export type DotRemoteConnectionInput = { origin: string; serviceToken: string }

export type DotRemoteModel = {
  /** Null until the first successful read; a later failed read keeps the last one and sets `loadError`. */
  status: WorkbenchDotRemoteStatusView | null
  /** The latest pairing view, kept after it ends while the status still agrees with it. */
  pairing: WorkbenchDotRemotePairingView | null
  loadError: string | null
  loading: boolean
  busy: DotRemoteScope | null
  refusal: DotRemoteRefusal | null
  /** Set when a revocation was fenced on this computer but the Site could not be told. */
  siteNotTold: boolean
  refresh: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<boolean>
  /** Sends the token once; the hook never keeps it. */
  saveConnection: (input: DotRemoteConnectionInput) => Promise<boolean>
  startPairing: () => Promise<boolean>
  revoke: () => Promise<boolean>
}

async function call<T>(method: string, schema: z.ZodType<T>, params?: unknown): Promise<T> {
  return schema.parse(await callRuntimeRpc<unknown>(LOCAL, method, params))
}

/** Desktop-only remote access (R1): every change answers with the status the app now holds. */
export function useDotRemoteAccess(): DotRemoteModel {
  const mountedRef = useMountedRef()
  /** Background status reads: only the newest one may apply. */
  const readRef = useRef(0)
  /** User changes: moved on when one starts and when it answers, so an older read is dropped. */
  const changeRef = useRef(0)
  const pairingSequenceRef = useRef(0)
  const busyRef = useRef(false)
  const [status, setStatus] = useState<WorkbenchDotRemoteStatusView | null>(null)
  const [pairing, setPairing] = useState<WorkbenchDotRemotePairingView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<DotRemoteScope | null>(null)
  const [refusal, setRefusal] = useState<DotRemoteRefusal | null>(null)
  const [siteNotTold, setSiteNotTold] = useState(false)

  /** Every status update goes through here, so a pairing outcome never outlives its pairing. */
  const applyStatus = useCallback((next: WorkbenchDotRemoteStatusView): void => {
    setStatus(next)
    setPairing((view) => reconcileDotRemotePairingView(view, next))
  }, [])

  /** A new view moves the sequence on, so a pairing read that started earlier is dropped. */
  const replacePairing = useCallback((view: WorkbenchDotRemotePairingView | null): void => {
    pairingSequenceRef.current += 1
    setPairing(view)
  }, [])

  const readPairing = useCallback(async (): Promise<void> => {
    const sequence = pairingSequenceRef.current
    try {
      const next = await readDotRemotePairingView()
      if (mountedRef.current && sequence === pairingSequenceRef.current) {
        setPairing(next)
      }
    } catch (caught) {
      if (mountedRef.current) {
        setRefusal({ scope: 'pairing', message: dotRemoteCallErrorMessage(caught) })
      }
    }
  }, [mountedRef])

  const refresh = useCallback(async (): Promise<void> => {
    const read = ++readRef.current
    const changes = changeRef.current
    let next: WorkbenchDotRemoteStatusView | null = null
    let error: string | null = null
    try {
      next = await call('workbench.dotRemote.status', WorkbenchDotRemoteStatusViewSchema)
    } catch (caught) {
      error = dotRemoteCallErrorMessage(caught)
    }
    // Why both counters: a slow read must not overwrite a newer read or the answer of a change.
    if (!mountedRef.current || read !== readRef.current || changes !== changeRef.current) {
      return
    }
    if (next !== null) {
      applyStatus(next)
    }
    setLoadError(error)
    setLoading(false)
    if (next?.state === 'pairing') {
      await readPairing()
    }
  }, [mountedRef, applyStatus, readPairing])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useDotRemotePairingPoll({
    waiting: pairing?.state === 'waiting_for_approval',
    sequenceRef: pairingSequenceRef,
    mountedRef,
    refresh,
    setPairing,
    setRefusal
  })

  const run = useCallback(
    async <T>(scope: DotRemoteScope, operation: () => Promise<T>, apply: (value: T) => void) => {
      // Why: disabled controls can still fire twice (Enter, then click) before React re-renders.
      if (busyRef.current) {
        return false
      }
      busyRef.current = true
      setBusy(scope)
      setRefusal(null)
      setSiteNotTold(false)
      changeRef.current += 1
      let ok = false
      try {
        const value = await operation()
        ok = true
        changeRef.current += 1
        // Why always applied: a background read never drops what the user's own change answered.
        if (mountedRef.current) {
          apply(value)
          setLoadError(null)
        }
      } catch (caught) {
        if (mountedRef.current) {
          setRefusal({ scope, message: dotRemoteCallErrorMessage(caught) })
          // Why: a refused change can still move the state (a refused token stops polling).
          await refresh()
        }
      }
      busyRef.current = false
      if (mountedRef.current) {
        setBusy(null)
      }
      return ok
    },
    [mountedRef, refresh]
  )

  const setEnabled = useCallback(
    (enabled: boolean) =>
      run(
        'switch',
        () =>
          call(
            enabled ? 'workbench.dotRemote.enable' : 'workbench.dotRemote.disable',
            WorkbenchDotRemoteStatusViewSchema
          ),
        (next) => {
          applyStatus(next)
          if (!enabled) {
            replacePairing(null)
          }
        }
      ),
    [run, applyStatus, replacePairing]
  )
  const saveConnection = useCallback(
    (input: DotRemoteConnectionInput) =>
      run(
        'connection',
        () =>
          call('workbench.dotRemote.setConnection', WorkbenchDotRemoteStatusViewSchema, {
            origin: input.origin,
            serviceToken: input.serviceToken
          }),
        applyStatus
      ),
    [run, applyStatus]
  )
  const startPairing = useCallback(
    () =>
      run(
        'pairing',
        () => call('workbench.dotRemote.pairing.start', WorkbenchDotRemotePairingStartResultSchema),
        (result) => {
          applyStatus(result.status)
          replacePairing(result.pairing)
        }
      ),
    [run, applyStatus, replacePairing]
  )
  const revoke = useCallback(
    () =>
      run(
        'revoke',
        () => call('workbench.dotRemote.revoke', WorkbenchDotRemoteRevokeResultSchema),
        (result) => {
          applyStatus(result.status)
          replacePairing(null)
          setSiteNotTold(!result.siteConfirmed)
        }
      ),
    [run, applyStatus, replacePairing]
  )

  return {
    status,
    pairing,
    loadError,
    loading,
    busy,
    refusal,
    siteNotTold,
    refresh,
    setEnabled,
    saveConnection,
    startPairing,
    revoke
  }
}

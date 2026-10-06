import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  WorkbenchDotRemotePairingViewSchema,
  type WorkbenchDotRemotePairingView,
  type WorkbenchDotRemoteStatusView
} from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { dotRemoteCallErrorMessage } from './dot-remote-refusal-messages'
import type { DotRemoteRefusal } from './use-dot-remote-access'

type PairingView = WorkbenchDotRemotePairingView

/** Reads the app's own pairing state; the app itself asks the Site at the Site's poll interval. */
const PAIRING_POLL_MS = 2_000

export async function readDotRemotePairingView(): Promise<PairingView> {
  return WorkbenchDotRemotePairingViewSchema.parse(
    await callRuntimeRpc<unknown>(
      { kind: 'local' },
      'workbench.dotRemote.pairing.status',
      undefined
    )
  )
}

/** Keeps a pairing view only while the status still agrees with it, so no stale outcome lingers. */
export function reconcileDotRemotePairingView(
  view: PairingView | null,
  status: WorkbenchDotRemoteStatusView
): PairingView | null {
  switch (view?.state) {
    case undefined:
    case 'idle':
      return null
    case 'waiting_for_approval':
      return status.state === 'pairing' ? view : null
    case 'paired':
      return status.pairing === null ? null : view
    case 'denied':
    case 'expired':
    case 'failed':
      return status.enabled && status.pairing === null ? view : null
  }
}

/**
 * Polls the pairing view while it waits for approval, then re-reads the status once it ends. An
 * answer is dropped when the effect was cleaned up or the view was replaced while it was in flight.
 */
export function useDotRemotePairingPoll(args: {
  waiting: boolean
  sequenceRef: MutableRefObject<number>
  mountedRef: MutableRefObject<boolean>
  refresh: () => Promise<void>
  setPairing: Dispatch<SetStateAction<PairingView | null>>
  setRefusal: Dispatch<SetStateAction<DotRemoteRefusal | null>>
}): void {
  const { waiting, sequenceRef, mountedRef, refresh, setPairing, setRefusal } = args
  useEffect(() => {
    if (!waiting) {
      return undefined
    }
    let cancelled = false
    let inFlight = false
    const current = (sequence: number): boolean =>
      !cancelled && mountedRef.current && sequence === sequenceRef.current
    const poll = async (): Promise<void> => {
      if (inFlight) {
        return
      }
      inFlight = true
      const sequence = sequenceRef.current
      try {
        const next = await readDotRemotePairingView()
        if (!current(sequence)) {
          return
        }
        setPairing(next)
        setRefusal((shown) => (shown?.scope === 'pairing' ? null : shown))
        if (next.state !== 'waiting_for_approval') {
          await refresh()
        }
      } catch (caught) {
        // Why keep polling: the next tick retries; the line stays until a read succeeds.
        if (current(sequence)) {
          setRefusal({ scope: 'pairing', message: dotRemoteCallErrorMessage(caught) })
        }
      } finally {
        inFlight = false
      }
    }
    const stop = installWindowVisibilityInterval({
      run: () => void poll(),
      intervalMs: PAIRING_POLL_MS
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [waiting, sequenceRef, mountedRef, refresh, setPairing, setRefusal])
}

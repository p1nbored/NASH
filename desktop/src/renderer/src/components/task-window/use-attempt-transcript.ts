import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { WorkbenchAttemptTranscriptReadResultSchema } from '../../../../shared/rpc-contract/workbench-task-window-params'
import { toWorkbenchError } from '../right-sidebar/workbench-rpc-error'
import {
  TRANSCRIPT_READ_BYTES,
  TRANSCRIPT_SETTLE_GRACE_READS,
  applyTranscriptRead,
  initialTranscriptState,
  planNextTranscriptRead,
  withTranscriptError,
  type TranscriptReadState
} from './task-window-transcript-state'

const LOCAL = { kind: 'local' } as const
const CACHE_LIMIT = 8
// Why a cache: the tab unmounts while another tab is shown; reading resumes where it stopped.
const transcriptCache = new Map<string, TranscriptReadState>()

function remember(state: TranscriptReadState): void {
  transcriptCache.delete(state.dispatchId)
  transcriptCache.set(state.dispatchId, state)
  for (const oldest of transcriptCache.keys()) {
    if (transcriptCache.size <= CACHE_LIMIT) {
      break
    }
    transcriptCache.delete(oldest)
  }
}

export function resetAttemptTranscriptCache(): void {
  transcriptCache.clear()
}

function readFailure(error: unknown) {
  return toWorkbenchError(
    error,
    translate('workbench.taskWindow.readFailed', 'The transcript could not be read.')
  )
}

/**
 * D-024: reads an attempt's transcript from the start, then once a second while it is live; it
 * stops after the end record, on a final refusal, and when the tab unmounts.
 */
export function useAttemptTranscript(dispatchId: string | null): TranscriptReadState | null {
  const [state, setState] = useState<TranscriptReadState | null>(null)
  useEffect(() => {
    if (dispatchId === null) {
      return
    }
    let current = transcriptCache.get(dispatchId) ?? initialTranscriptState(dispatchId)
    let active = true
    let timer: number | undefined
    let graceLeft = TRANSCRIPT_SETTLE_GRACE_READS
    const publish = (next: TranscriptReadState): void => {
      current = next
      remember(next)
      setState(next)
    }
    const read = async (): Promise<void> => {
      timer = undefined
      const from = current.nextByteOffset
      let consumed = 0
      try {
        const raw = await callRuntimeRpc<unknown>(LOCAL, 'workbench.attempts.transcript.read', {
          dispatchId,
          fromByteOffset: from,
          maxBytes: TRANSCRIPT_READ_BYTES
        })
        if (!active) {
          return
        }
        const result = WorkbenchAttemptTranscriptReadResultSchema.parse(raw)
        consumed = result.nextByteOffset - from
        publish(applyTranscriptRead(current, result, from))
      } catch (error) {
        if (!active) {
          return
        }
        publish(withTranscriptError(current, readFailure(error)))
      }
      if (!current.live && !current.ended) {
        graceLeft -= 1
      }
      const delay = planNextTranscriptRead(current, { consumed, graceLeft })
      if (delay !== null && active) {
        timer = window.setTimeout(() => void read(), delay)
      }
    }
    setState(current)
    if (!current.loaded || planNextTranscriptRead(current, { consumed: 0, graceLeft }) !== null) {
      void read()
    }
    return () => {
      active = false
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [dispatchId])
  return state !== null && state.dispatchId === dispatchId ? state : null
}

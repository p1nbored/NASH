import {
  getKeyedSerializedQueueTail,
  runKeyedSerializedOperation
} from '../../cli/keyed-promise-queue'

/** A one-shot timer; the returned function cancels it. Injected so tests fire timers by hand. */
export type RunMessageTimers = {
  schedule(fn: () => void, ms: number): () => void
}

export const SYSTEM_RUN_MESSAGE_TIMERS: RunMessageTimers = {
  schedule(fn, ms) {
    const timer = setTimeout(fn, ms)
    // Why: a pending flush must never keep the app process alive at quit.
    timer.unref?.()
    return () => clearTimeout(timer)
  }
}

/** Runs work for one key strictly one after another, so a later message never overtakes an earlier one. */
export function createKeyedSerializer() {
  const tails = new Map<string, Promise<void>>()
  return {
    run<T>(key: string, work: () => Promise<T>): Promise<T> {
      return runKeyedSerializedOperation(tails, key, work)
    },
    /** Resolves once everything queued for the key so far has finished. */
    async drain(key: string): Promise<void> {
      await getKeyedSerializedQueueTail(tails, key)
    }
  }
}

/** One fallback timer for all held runs; native status events normally flush them first. */
export function createRunFlushTimers(timers: RunMessageTimers, intervalMs: number) {
  const pending = new Map<string, () => void>()
  let cancelTimer: (() => void) | undefined
  let disposed = false
  return {
    arm(runId: string, flush: () => void): void {
      if (disposed || pending.has(runId)) {
        return
      }
      pending.set(runId, flush)
      cancelTimer ??= timers.schedule(() => {
        cancelTimer = undefined
        const due = [...pending.values()]
        pending.clear()
        for (const callback of due) {
          callback()
        }
      }, intervalMs)
    },
    cancel(runId: string): void {
      pending.delete(runId)
      if (pending.size === 0) {
        cancelTimer?.()
        cancelTimer = undefined
      }
    },
    dispose(): void {
      disposed = true
      cancelTimer?.()
      cancelTimer = undefined
      pending.clear()
    }
  }
}

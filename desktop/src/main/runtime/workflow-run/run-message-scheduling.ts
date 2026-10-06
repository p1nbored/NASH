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
      const previous = tails.get(key) ?? Promise.resolve()
      const result = previous.then(work)
      const tail = result.then(
        () => undefined,
        () => undefined
      )
      tails.set(key, tail)
      void tail.then(() => {
        if (tails.get(key) === tail) {
          tails.delete(key)
        }
      })
      return result
    },
    /** Resolves once everything queued for the key so far has finished. */
    async drain(key: string): Promise<void> {
      await (tails.get(key) ?? Promise.resolve())
    }
  }
}

/** At most one pending flush timer per run. */
export function createRunFlushTimers(timers: RunMessageTimers, intervalMs: number) {
  const pending = new Map<string, () => void>()
  let disposed = false
  return {
    arm(runId: string, flush: () => void): void {
      if (disposed || pending.has(runId)) {
        return
      }
      const cancel = timers.schedule(() => {
        pending.delete(runId)
        flush()
      }, intervalMs)
      pending.set(runId, cancel)
    },
    cancel(runId: string): void {
      pending.get(runId)?.()
      pending.delete(runId)
    },
    dispose(): void {
      disposed = true
      for (const cancel of pending.values()) {
        cancel()
      }
      pending.clear()
    }
  }
}

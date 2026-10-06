// Injected time for the sync agent, so every poll, renewal and backoff is driven by a fake in tests.

export type DotRemoteTimerHandle = { readonly cancel: () => void }

export type DotRemoteTimers = {
  schedule(run: () => void, ms: number): DotRemoteTimerHandle
}

/** Unref'd, so a pending poll never keeps the process alive on its own. */
export const REAL_DOT_REMOTE_TIMERS: DotRemoteTimers = {
  schedule: (run, ms) => {
    const timer = setTimeout(run, ms)
    timer.unref?.()
    return { cancel: () => clearTimeout(timer) }
  }
}

/** Codes, ids and counts only; never a token, a body, a path or error text. */
export type DotRemoteLogEvent = {
  readonly event: string
  readonly [key: string]: string | number | boolean | null
}

export type DotRemoteLog = (event: DotRemoteLogEvent) => void

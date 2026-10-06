/** Between two wait slices the hook counts as waiting this long while it opens the next one. */
export const PERMISSION_WAITER_GRACE_MS = 5_000

type Listener = () => void
type Entry = Readonly<{ active: number; lastSeenAt: number; listeners: ReadonlySet<Listener> }>

/**
 * Which prompts still have a hook process waiting for them. An answer is accepted only while one
 * is, so a recorded allow or deny always reaches Claude Code instead of landing after the hook
 * gave the prompt to the terminal.
 */
export class PermissionRelayWaiters {
  private readonly entries = new Map<string, Entry>()

  open(decisionId: string, now: number): void {
    this.entries.set(decisionId, { active: 0, lastSeenAt: now, listeners: new Set() })
  }

  enter(decisionId: string, now: number): void {
    const entry = this.entries.get(decisionId) ?? {
      active: 0,
      lastSeenAt: now,
      listeners: new Set()
    }
    this.entries.set(decisionId, { ...entry, active: entry.active + 1 })
  }

  leave(decisionId: string, now: number): void {
    const entry = this.entries.get(decisionId)
    if (entry) {
      this.entries.set(decisionId, {
        ...entry,
        active: Math.max(0, entry.active - 1),
        lastSeenAt: now
      })
    }
  }

  isWaiting(decisionId: string, now: number): boolean {
    const entry = this.entries.get(decisionId)
    return Boolean(
      entry && (entry.active > 0 || now - entry.lastSeenAt <= PERMISSION_WAITER_GRACE_MS)
    )
  }

  notify(decisionId: string): void {
    for (const listener of this.entries.get(decisionId)?.listeners ?? []) {
      listener()
    }
  }

  forget(decisionId: string): void {
    this.entries.delete(decisionId)
  }

  /** Resolves on the first of: a change to this prompt, the abort signal, or `ms` elapsing. */
  waitForChange(decisionId: string, ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done: Listener = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        this.replaceListeners(decisionId, (listeners) => listeners.delete(done))
        resolve()
      }
      const timer = setTimeout(done, Math.max(0, ms))
      signal?.addEventListener('abort', done, { once: true })
      this.replaceListeners(decisionId, (listeners) => listeners.add(done))
    })
  }

  private replaceListeners(decisionId: string, change: (listeners: Set<Listener>) => void): void {
    const entry = this.entries.get(decisionId)
    if (entry) {
      const listeners = new Set(entry.listeners)
      change(listeners)
      this.entries.set(decisionId, { ...entry, listeners })
    }
  }
}

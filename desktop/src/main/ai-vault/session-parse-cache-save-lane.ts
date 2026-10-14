import {
  sessionParseCacheRevision,
  snapshotSessionParseCacheForPersistence,
  type PersistedSessionParseCacheEntry
} from './session-parse-cache-store'

const SAVE_DEBOUNCE_MS = 1_500
const SAVE_MAX_WAIT_MS = 15_000
type Snapshot = [string, PersistedSessionParseCacheEntry][]

// One active snapshot and one latest due revision; failed versions never retry on their own.
export class SessionParseCacheSaveLane {
  private savedRevision = 0
  private attemptedRevision = 0
  private requestedRevision = 0
  private dueRevision = 0
  private active: { revision: number; promise: Promise<void> } | null = null
  private timer: NodeJS.Timeout | null = null
  private pendingSince: number | null = null
  private disposed = false

  constructor(
    private readonly load: () => Promise<void>,
    private readonly persist: (entries: Snapshot) => Promise<boolean>
  ) {}

  request(): void {
    const revision = sessionParseCacheRevision()
    if (
      this.disposed ||
      revision <= Math.max(this.savedRevision, this.attemptedRevision, this.requestedRevision)
    ) {
      return
    }
    this.requestedRevision = revision
    const now = Date.now()
    this.pendingSince ??= now
    if (this.timer) {
      clearTimeout(this.timer)
    }
    const delay = Math.max(
      0,
      Math.min(SAVE_DEBOUNCE_MS, this.pendingSince + SAVE_MAX_WAIT_MS - now)
    )
    this.timer = setTimeout(() => {
      this.clearTimer()
      this.dueRevision = Math.max(this.dueRevision, this.requestedRevision)
      this.startSave()
    }, delay)
    if (typeof this.timer.unref === 'function') {
      this.timer.unref()
    }
  }

  async flush(): Promise<void> {
    if (this.disposed) {
      return
    }
    const target = sessionParseCacheRevision()
    this.clearTimer()
    if (target <= this.savedRevision) {
      return
    }
    this.dueRevision = Math.max(this.dueRevision, target)
    const running = this.active
    if (running) {
      await running.promise
      if (this.savedRevision >= target) {
        return
      }
    }
    // A newer coalesced save may have started as the older one finished.
    const followup = this.active
    if (followup) {
      await followup.promise
      return
    }
    this.dueRevision = Math.max(this.dueRevision, target)
    await this.startSave(true)
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.dueRevision = 0
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pendingSince = null
  }

  private startSave(retry = false): Promise<void> | null {
    if (this.disposed || this.active) {
      return this.active?.promise ?? null
    }
    if (
      this.dueRevision <= this.savedRevision ||
      (!retry && this.dueRevision <= this.attemptedRevision)
    ) {
      this.dueRevision = 0
      return null
    }
    this.dueRevision = 0
    const active = { revision: 0, promise: Promise.resolve() }
    const promise = this.load()
      .then(async () => {
        if (this.disposed) {
          return
        }
        const revision = sessionParseCacheRevision()
        if (revision <= this.savedRevision || (!retry && revision <= this.attemptedRevision)) {
          return
        }
        const entries = snapshotSessionParseCacheForPersistence()
        active.revision = revision
        this.dueRevision = 0
        this.attemptedRevision = revision
        if (this.requestedRevision <= revision) {
          this.clearTimer()
        }
        const saved = await this.persist(entries)
        if (saved) {
          this.savedRevision = revision
        }
      })
      .finally(() => {
        this.active = null
        this.startSave()
      })
    active.promise = promise
    this.active = active
    return promise
  }
}

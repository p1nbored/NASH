import {
  serializeTranscriptRecord,
  TRANSCRIPT_FORMAT_VERSION,
  type TranscriptEnd,
  type TranscriptRecord,
  type TranscriptStart
} from './attempt-transcript-records'
import type { TranscriptRetentionResult } from './attempt-transcript-retention'
import type {
  AttemptTranscriptDeps,
  AttemptTranscriptErrorCode,
  AttemptTranscriptOutcome,
  TranscriptFileHandle
} from './attempt-transcript'

// The queue and the single writer behind one attempt transcript: appends return at once, one drain
// writes batches in order, and the caps (record, file, queue) are applied as each line is numbered.

const MAX_RECORD_BYTES = 8 * 1024
const MAX_FILE_BYTES = 8 * 1024 * 1024
/** Kept free for the `end` record, which is always written. */
const END_RESERVE_BYTES = 4 * 1024
/** Kept free for the one `truncated` note. */
const NOTE_RESERVE_BYTES = 256
const MAX_QUEUED_RECORDS = 1_000

type Queued = { readonly body: string; readonly isEnd: boolean }

export class TranscriptWriter {
  private readonly queue: Queued[] = []
  private inFlight = 0
  private nextSeq = 0
  private writtenBytes = 0
  private droppedSinceNote = 0
  private droppedTotal = 0
  private truncated = false
  private stopped = false
  private errorCode: AttemptTranscriptErrorCode | null = null
  private errorCount = 0
  private retention: TranscriptRetentionResult | null = null
  private draining: Promise<void> | null = null
  private finished: Promise<AttemptTranscriptOutcome> | null = null
  private readonly handle: Promise<TranscriptFileHandle | null>
  private readonly retentionDone: Promise<void>

  constructor(
    path: string,
    runsRoot: string,
    start: TranscriptStart,
    private readonly deps: AttemptTranscriptDeps
  ) {
    // Why first: the drain that `start` schedules awaits this handle.
    this.handle = Promise.resolve()
      .then(() => deps.open(path))
      .catch(() => {
        this.fail('transcript_open_failed')
        this.stopped = true
        return null
      })
    this.retentionDone = Promise.resolve()
      .then(() => deps.prune(runsRoot))
      .then(
        (result) => {
          this.retention = result
        },
        () => {
          this.retention = { deleted: 0, errors: 1 }
        }
      )
    this.enqueue({ kind: 'start', ...start })
  }

  readonly append = (record: TranscriptRecord): void => {
    if (this.finished !== null || this.stopped) {
      return
    }
    if (this.queue.length + this.inFlight >= MAX_QUEUED_RECORDS) {
      this.droppedSinceNote += 1
      this.droppedTotal += 1
      return
    }
    this.noteDropped()
    this.enqueue(record)
  }

  readonly fault = (): void => this.fail('transcript_record_failed')

  readonly finish = (end: TranscriptEnd): Promise<AttemptTranscriptOutcome> => {
    this.finished ??= this.settle(end)
    return this.finished
  }

  private fail(code: AttemptTranscriptErrorCode): void {
    this.errorCount += 1
    this.errorCode ??= code
  }

  private noteDropped(): void {
    if (this.droppedSinceNote > 0) {
      const count = this.droppedSinceNote
      this.droppedSinceNote = 0
      this.enqueue({ kind: 'note', code: 'records_dropped', count })
    }
  }

  private serialize(record: TranscriptRecord): string | null {
    try {
      const at = new Date(this.deps.now()).toISOString()
      return serializeTranscriptRecord(record, at, MAX_RECORD_BYTES)
    } catch {
      return null
    }
  }

  private enqueue(record: TranscriptRecord): void {
    const body = this.serialize(record)
    if (body === null) {
      this.fail('transcript_record_failed')
      return
    }
    this.queue.push({ body, isEnd: record.kind === 'end' })
    this.scheduleDrain()
  }

  private scheduleDrain(): void {
    if (this.draining !== null) {
      return
    }
    this.draining = this.drain()
      .catch(() => {
        // Not expected (each write is caught), but a rejection here must never reach the main process.
        this.fail('transcript_write_failed')
        this.stopped = true
      })
      .finally(() => {
        this.draining = null
        // Why: a record queued after the loop's last check would otherwise wait for the next one.
        if (this.queue.length > 0) {
          this.scheduleDrain()
        }
      })
  }

  private async drain(): Promise<void> {
    const handle = await this.handle
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0)
      if (handle === null || this.stopped) {
        continue
      }
      this.inFlight = batch.length
      try {
        const text = this.render(batch)
        if (text !== '') {
          await handle.write(text)
        }
      } catch {
        this.fail('transcript_write_failed')
        this.stopped = true
      } finally {
        this.inFlight = 0
      }
    }
  }

  private render(batch: readonly Queued[]): string {
    const lines: string[] = []
    for (const item of batch) {
      const line = this.lineFor(item)
      if (line !== null) {
        lines.push(line)
      }
    }
    return lines.join('')
  }

  /** Numbers the record and applies the file cap: past it, one `truncated` note, then only `end`. */
  private lineFor(item: Queued): string | null {
    if (this.truncated && !item.isEnd) {
      return null
    }
    const line = `{"v":${TRANSCRIPT_FORMAT_VERSION},"seq":${this.nextSeq},${item.body.slice(1)}\n`
    const bytes = Buffer.byteLength(line)
    const limit = item.isEnd
      ? MAX_FILE_BYTES
      : MAX_FILE_BYTES - END_RESERVE_BYTES - NOTE_RESERVE_BYTES
    if (this.writtenBytes + bytes <= limit) {
      this.nextSeq += 1
      this.writtenBytes += bytes
      return line
    }
    if (item.isEnd) {
      return null
    }
    this.truncated = true
    const note = this.serialize({ kind: 'note', code: 'truncated' })
    return note === null ? null : this.lineFor({ body: note, isEnd: true })
  }

  private async idle(): Promise<void> {
    while (this.draining !== null) {
      await this.draining
    }
  }

  private async close(): Promise<void> {
    await this.idle()
    const handle = await this.handle
    try {
      await handle?.close()
    } catch {
      this.fail('transcript_close_failed')
    }
  }

  private async settle(end: TranscriptEnd): Promise<AttemptTranscriptOutcome> {
    if (!this.stopped) {
      this.noteDropped()
      this.enqueue({ kind: 'end', ...end })
    }
    const work = Promise.all([this.close(), this.retentionDone]).then(() => undefined)
    if (await timedOut(work, this.deps.flushTimeoutMs)) {
      this.fail('transcript_flush_timeout')
    }
    return {
      errorCode: this.errorCode,
      errorCount: this.errorCount,
      droppedRecords: this.droppedTotal,
      truncated: this.truncated,
      retention: this.retention
    }
  }
}

/** Resolves true when `work` is still pending after `timeoutMs`; the timer never holds the process open. */
function timedOut(work: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), timeoutMs)
    timer.unref?.()
    const done = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    work.then(done, done)
  })
}

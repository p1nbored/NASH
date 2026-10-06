import type { TranscriptRecord, TranscriptRow } from './task-window-records'

// A transcript's rows, appended read by read without copying the rows before them: rows live in
// fixed-size chunks, so a read costs its own rows plus the chunks it touches; a read that adds a
// command also copies the command index, which is far smaller than the rows. A command's later
// records update its first row, as the window has always shown it.

export const TRANSCRIPT_ROW_CHUNK = 256

type StartRecord = Extract<TranscriptRecord, { kind: 'start' }>
type EndRecord = Extract<TranscriptRecord, { kind: 'end' }>

export type TranscriptRowLog = {
  /** Every chunk but the last holds exactly TRANSCRIPT_ROW_CHUNK rows. */
  readonly chunks: readonly (readonly TranscriptRow[])[]
  readonly length: number
  /** The row index of each command id, so its later records update that row. */
  readonly commandRows: ReadonlyMap<string, number>
  readonly start: StartRecord | null
  readonly end: EndRecord | null
}

export const EMPTY_TRANSCRIPT_ROW_LOG: TranscriptRowLog = {
  chunks: [],
  length: 0,
  commandRows: new Map(),
  start: null,
  end: null
}

/** A new log with the records appended; the given log is left as it was. */
export function appendTranscriptRecords(
  log: TranscriptRowLog,
  records: readonly TranscriptRecord[]
): TranscriptRowLog {
  if (records.length === 0) {
    return log
  }
  const chunks = [...log.chunks]
  const drafts = new Map<number, TranscriptRow[]>()
  // Why drafts: only a chunk this read writes to is copied, once; the others stay shared.
  const writable = (index: number): TranscriptRow[] => {
    const draft = drafts.get(index) ?? [...(chunks[index] ?? [])]
    drafts.set(index, draft)
    chunks[index] = draft
    return draft
  }
  let ownCommandRows: Map<string, number> | null = null
  let { length, start, end } = log
  for (const record of records) {
    start = start ?? (record.kind === 'start' ? record : null)
    end = record.kind === 'end' ? record : end
    const id = record.kind === 'command' ? record.id : null
    const existing = id === null ? undefined : (ownCommandRows ?? log.commandRows).get(id)
    if (existing !== undefined) {
      const chunk = writable(Math.floor(existing / TRANSCRIPT_ROW_CHUNK))
      const offset = existing % TRANSCRIPT_ROW_CHUNK
      chunk[offset] = { ...record, key: chunk[offset].key }
      continue
    }
    writable(Math.floor(length / TRANSCRIPT_ROW_CHUNK)).push({
      ...record,
      key: `line-${record.line}`
    })
    if (id !== null) {
      ownCommandRows ??= new Map(log.commandRows)
      ownCommandRows.set(id, length)
    }
    length += 1
  }
  return { chunks, length, commandRows: ownCommandRows ?? log.commandRows, start, end }
}

/** The rows from `from` to the end, in order; the window renders only its newest rows. */
export function transcriptRowsFrom(log: TranscriptRowLog, from: number): TranscriptRow[] {
  const first = Math.min(Math.max(0, from), log.length)
  const firstChunk = Math.floor(first / TRANSCRIPT_ROW_CHUNK)
  return log.chunks
    .slice(firstChunk)
    .flatMap((chunk, index) => (index === 0 ? chunk.slice(first % TRANSCRIPT_ROW_CHUNK) : chunk))
}

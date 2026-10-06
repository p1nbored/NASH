import { describe, expect, it } from 'vitest'
import { parseTranscriptLine, type TranscriptRecord } from './task-window-records'
import {
  EMPTY_TRANSCRIPT_ROW_LOG,
  TRANSCRIPT_ROW_CHUNK,
  appendTranscriptRecords,
  transcriptRowsFrom
} from './task-window-row-log'

// TypeScript review L8: a read appends its rows without copying the transcript before it, so a long
// live attempt costs each read its own rows plus at most the chunks it touches.

const AT = '2026-10-05T18:00:00.000Z'
function rec(line: number, kind: string, extra: Record<string, unknown> = {}): TranscriptRecord {
  return parseTranscriptLine(JSON.stringify({ v: 1, seq: line, at: AT, kind, ...extra }), line)
}
const output = (line: number) => rec(line, 'output', { stream: 'stdout', text: `line ${line}` })
const outputs = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => output(from + index))
const command = (line: number, status: string) =>
  rec(line, 'command', { id: 'item_1', status, command: 'ls', exitCode: null, output: null })

describe('transcript row log', () => {
  it('appends a read without copying the full chunks before it', () => {
    const size = TRANSCRIPT_ROW_CHUNK * 2 + 10
    const log = appendTranscriptRecords(EMPTY_TRANSCRIPT_ROW_LOG, outputs(0, size))
    const next = appendTranscriptRecords(log, [output(size)])

    expect(next.length).toBe(size + 1)
    expect(next.chunks[0]).toBe(log.chunks[0])
    expect(next.chunks[1]).toBe(log.chunks[1])
    expect(transcriptRowsFrom(next, size).map((row) => row.key)).toEqual([`line-${size}`])
    expect(log.length).toBe(size)
    expect(transcriptRowsFrom(log, 0)).toHaveLength(size)
  })

  it('reads any tail across chunk boundaries in order', () => {
    const log = appendTranscriptRecords(EMPTY_TRANSCRIPT_ROW_LOG, outputs(0, 600))
    const tail = transcriptRowsFrom(log, TRANSCRIPT_ROW_CHUNK - 2)
    expect(tail).toHaveLength(600 - (TRANSCRIPT_ROW_CHUNK - 2))
    expect(tail[0]?.line).toBe(TRANSCRIPT_ROW_CHUNK - 2)
    expect(tail.at(-1)?.line).toBe(599)
    expect(transcriptRowsFrom(log, 600)).toEqual([])
  })

  it('merges a command finishing reads later into its first row, copying only that chunk', () => {
    const started = appendTranscriptRecords(EMPTY_TRANSCRIPT_ROW_LOG, [
      command(0, 'started'),
      ...outputs(1, TRANSCRIPT_ROW_CHUNK + 5)
    ])
    const finished = appendTranscriptRecords(started, [
      command(TRANSCRIPT_ROW_CHUNK + 6, 'completed')
    ])

    expect(finished.length).toBe(started.length)
    expect(transcriptRowsFrom(finished, 0)[0]).toMatchObject({
      kind: 'command',
      status: 'completed',
      key: 'line-0'
    })
    expect(transcriptRowsFrom(started, 0)[0]).toMatchObject({ status: 'started' })
    expect(finished.chunks[1]).toBe(started.chunks[1])
  })

  it('keeps the first start and the last end record', () => {
    const log = appendTranscriptRecords(EMPTY_TRANSCRIPT_ROW_LOG, [
      rec(0, 'start', { executor: 'codex' }),
      rec(1, 'end', { state: 'failed', exitCode: 1, reasonCode: null })
    ])
    const next = appendTranscriptRecords(log, [
      rec(2, 'start', { executor: 'agy' }),
      rec(3, 'end', { state: 'completed', exitCode: 0, reasonCode: null })
    ])
    expect(next.start).toMatchObject({ line: 0, executor: 'codex' })
    expect(next.end).toMatchObject({ line: 3, state: 'completed' })
  })

  it('returns the same log for a read without records', () => {
    const log = appendTranscriptRecords(EMPTY_TRANSCRIPT_ROW_LOG, outputs(0, 3))
    expect(appendTranscriptRecords(log, [])).toBe(log)
  })
})

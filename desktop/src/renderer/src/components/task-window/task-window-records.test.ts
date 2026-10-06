import { describe, expect, it } from 'vitest'
import { parseTranscriptLine, type TranscriptRecord } from './task-window-records'
import {
  EMPTY_TRANSCRIPT_ROW_LOG,
  appendTranscriptRecords,
  transcriptRowsFrom
} from './task-window-row-log'

const buildTranscriptRows = (records: readonly TranscriptRecord[]) =>
  transcriptRowsFrom(appendTranscriptRecords(EMPTY_TRANSCRIPT_ROW_LOG, records), 0)

// FIXTURE_ONLY transcript lines in the design section 1.1 format.
const AT = '2026-10-05T18:00:00.000Z'
function line(kind: string, extra: Record<string, unknown> = {}, seq = 1): string {
  return JSON.stringify({ v: 1, seq, at: AT, kind, ...extra })
}

describe('parseTranscriptLine', () => {
  it('reads every record kind of the format', () => {
    const parsed = [
      line('start', {
        executor: 'codex',
        model: 'gpt-6.1-sol',
        effort: null,
        sandbox: 'read-only',
        cwd: 'C:/fixtures/autopilot',
        worktree: { branch: 'nash-1', path: 'C:/fixtures/wt', baseCommit: 'abc123' }
      }),
      line('command', {
        id: 'item_1',
        status: 'completed',
        command: 'pnpm test',
        exitCode: 0,
        output: 'ok'
      }),
      line('message', { text: 'Done.' }),
      line('file_change', { status: 'completed', paths: ['a.ts', 'b.ts'] }),
      line('tool', { itemType: 'mcp_tool_call', status: 'completed' }),
      line('turn', { phase: 'completed', usage: { input_tokens: 10 }, error: null }),
      line('output', { stream: 'stderr', text: 'warning' }),
      line('error', { text: 'Rate limited.' }),
      line('note', { code: 'records_dropped', count: 3 }),
      line('end', { state: 'completed', exitCode: 0, reasonCode: null })
    ].map((text, index) => parseTranscriptLine(text, index))

    expect(parsed.map((record) => record.kind)).toEqual([
      'start',
      'command',
      'message',
      'file_change',
      'tool',
      'turn',
      'output',
      'error',
      'note',
      'end'
    ])
    expect(parsed[0]).toMatchObject({
      model: 'gpt-6.1-sol',
      effort: null,
      sandbox: 'read-only',
      worktree: { branch: 'nash-1', baseCommit: 'abc123' }
    })
    expect(parsed[1]).toMatchObject({ id: 'item_1', exitCode: 0, output: 'ok' })
    expect(parsed[3]).toMatchObject({ paths: ['a.ts', 'b.ts'] })
    expect(parsed[5]).toMatchObject({ usage: { input: 10, cachedInput: null, output: null } })
    expect(parsed[6]).toMatchObject({ stream: 'stderr', text: 'warning' })
    expect(parsed[8]).toMatchObject({ code: 'records_dropped', count: 3 })
    expect(parsed[9]).toMatchObject({ state: 'completed', exitCode: 0, reasonCode: null })
  })

  it('keeps a kind it does not know as a neutral unknown record', () => {
    expect(parseTranscriptLine(line('reasoning_summary', { text: 'x' }), 4)).toEqual({
      kind: 'unknown',
      line: 4,
      at: AT,
      recordKind: 'reasoning_summary'
    })
  })

  it.each([
    ['invalid JSON', '{"v":1,"kind":"message","text":'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON string', '"message"'],
    ['a record with no kind', JSON.stringify({ v: 1, seq: 1 })],
    ['a message without text', line('message', { text: 42 })],
    ['a command without a command', line('command', { id: 'item_1', status: 'started' })]
  ])('turns %s into a malformed line instead of throwing', (_name, text) => {
    expect(parseTranscriptLine(text, 7)).toMatchObject({ kind: 'malformed', line: 7 })
  })

  it('bounds the text it keeps from a malformed line', () => {
    const record = parseTranscriptLine(`{${'x'.repeat(5000)}`, 0)
    expect(record.kind === 'malformed' ? record.text.length : 0).toBeLessThanOrEqual(240)
  })

  it('tolerates odd field types inside a known kind', () => {
    expect(
      parseTranscriptLine(
        line('file_change', { status: 'completed', paths: ['a.ts', 7, null, 'b.ts'] }),
        0
      )
    ).toMatchObject({ kind: 'file_change', paths: ['a.ts', 'b.ts'] })
    expect(
      parseTranscriptLine(line('turn', { phase: 'completed', usage: 'many', error: 3 }), 0)
    ).toMatchObject({ kind: 'turn', usage: null, error: null })
    expect(parseTranscriptLine(line('output', { stream: 'tty', text: 'x' }), 0)).toMatchObject({
      kind: 'output',
      stream: 'stdout'
    })
  })
})

describe('E3 writer shapes', () => {
  it('keeps a command whose item had no id as its own row', () => {
    const records = [
      line('command', { id: null, status: 'started', command: 'ls', exitCode: null, output: null }),
      line('command', { id: null, status: 'completed', command: 'ls', exitCode: 0, output: 'a' })
    ].map((text, index) => parseTranscriptLine(text, index))

    expect(records.map((record) => record.kind)).toEqual(['command', 'command'])
    expect(buildTranscriptRows(records)).toHaveLength(2)
  })

  it('reads camelCase usage and keeps a blank agy line', () => {
    expect(
      parseTranscriptLine(
        line('turn', {
          phase: 'completed',
          usage: {
            inputTokens: 120,
            cachedInputTokens: 40,
            outputTokens: 30,
            reasoningOutputTokens: 10
          },
          error: null
        }),
        0
      )
    ).toMatchObject({ usage: { input: 120, cachedInput: 40, output: 30 } })
    expect(parseTranscriptLine(line('output', { stream: 'stdout', text: '' }), 1)).toMatchObject({
      kind: 'output',
      text: ''
    })
  })
})

describe('buildTranscriptRows', () => {
  it('merges a command started and completed under one id into one row', () => {
    const records = [
      line('command', {
        id: 'item_1',
        status: 'started',
        command: 'ls',
        exitCode: null,
        output: null
      }),
      line('message', { text: 'Listing.' }),
      line('command', {
        id: 'item_1',
        status: 'failed',
        command: 'ls',
        exitCode: 2,
        output: 'nope'
      })
    ].map((text, index) => parseTranscriptLine(text, index))

    const rows = buildTranscriptRows(records)
    expect(rows.map((row) => row.kind)).toEqual(['command', 'message'])
    expect(rows[0]).toMatchObject({ status: 'failed', exitCode: 2, output: 'nope', key: 'line-0' })
  })
})

// FIXTURE_ONLY: synthetic `codex exec --json` lines; no CLI, model or credential is involved.
import { describe, expect, it } from 'vitest'
import type { TranscriptRecord } from '../agent-exec-shared/attempt-transcript-records'
import type { TranscriptSink } from '../agent-exec-shared/attempt-transcript'
import {
  appendCodexStdoutLine,
  codexTranscriptRecords,
  codexTranscriptStart
} from './codex-transcript-records'

const line = (event: Record<string, unknown>) => JSON.stringify(event)
const item = (phase: string, body: Record<string, unknown>) =>
  line({ type: `item.${phase}`, item: body })

describe('codexTranscriptRecords turns and errors', () => {
  it('maps turn.started, turn.completed with usage and turn.failed with its message', () => {
    expect(codexTranscriptRecords(line({ type: 'turn.started' }))).toEqual([
      { kind: 'turn', phase: 'started', usage: null, error: null }
    ])
    expect(
      codexTranscriptRecords(
        line({
          type: 'turn.completed',
          usage: { input_tokens: 120, cached_input_tokens: 40, output_tokens: 30 }
        })
      )
    ).toEqual([
      {
        kind: 'turn',
        phase: 'completed',
        usage: {
          inputTokens: 120,
          cachedInputTokens: 40,
          outputTokens: 30,
          reasoningOutputTokens: null
        },
        error: null
      }
    ])
    expect(
      codexTranscriptRecords(line({ type: 'turn.failed', error: { message: 'stream ended' } }))
    ).toEqual([{ kind: 'turn', phase: 'failed', usage: null, error: 'stream ended' }])
  })

  it('maps an error event and an error item to error records', () => {
    expect(codexTranscriptRecords(line({ type: 'error', message: 'reconnecting' }))).toEqual([
      { kind: 'error', text: 'reconnecting' }
    ])
    expect(
      codexTranscriptRecords(item('completed', { id: 'e1', type: 'error', message: 'denied' }))
    ).toEqual([{ kind: 'error', text: 'denied' }])
  })

  it('writes nothing for thread.started, unknown events or blank text', () => {
    expect(codexTranscriptRecords(line({ type: 'thread.started', thread_id: 't1' }))).toEqual([])
    expect(codexTranscriptRecords(line({ type: 'session.configured' }))).toEqual([])
  })

  it('keeps a non-JSON stdout line as plain stdout output', () => {
    expect(codexTranscriptRecords('Reading prompt from stdin...')).toEqual([
      { kind: 'output', stream: 'stdout', text: 'Reading prompt from stdin...' }
    ])
  })
})

describe('codexTranscriptRecords items', () => {
  it('maps a command from start to completion with its exit code and output tail', () => {
    expect(
      codexTranscriptRecords(
        item('started', {
          id: 'cmd_1',
          type: 'command_execution',
          command: 'git status',
          aggregated_output: '',
          exit_code: null,
          status: 'in_progress'
        })
      )
    ).toEqual([
      {
        kind: 'command',
        id: 'cmd_1',
        status: 'started',
        command: 'git status',
        exitCode: null,
        output: null
      }
    ])
    const output = `${'head '.repeat(2_000)}TAIL-END`
    const [completed] = codexTranscriptRecords(
      item('completed', {
        id: 'cmd_1',
        type: 'command_execution',
        command: 'git status',
        aggregated_output: output,
        exit_code: 0,
        status: 'completed'
      })
    )
    expect(completed).toMatchObject({ kind: 'command', status: 'completed', exitCode: 0 })
    const tail = completed?.kind === 'command' ? (completed.output ?? '') : ''
    expect(tail.endsWith('TAIL-END')).toBe(true)
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(4 * 1024)
  })

  it('marks a failed or declined command as failed', () => {
    for (const status of ['failed', 'declined']) {
      expect(
        codexTranscriptRecords(
          item('completed', {
            id: 'cmd_2',
            type: 'command_execution',
            command: 'false',
            aggregated_output: '',
            exit_code: 1,
            status
          })
        )
      ).toEqual([expect.objectContaining({ kind: 'command', status: 'failed', exitCode: 1 })])
    }
  })

  it('writes an agent message once it is complete', () => {
    const message = { id: 'msg_1', type: 'agent_message', text: 'The layout has three folders.' }
    expect(codexTranscriptRecords(item('started', message))).toEqual([])
    expect(codexTranscriptRecords(item('updated', message))).toEqual([])
    expect(codexTranscriptRecords(item('completed', message))).toEqual([
      { kind: 'message', text: 'The layout has three folders.' }
    ])
  })

  it('maps a file change to its status and at most 50 paths', () => {
    const changes = Array.from({ length: 60 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      kind: 'update'
    }))
    const [record] = codexTranscriptRecords(
      item('completed', { id: 'fc_1', type: 'file_change', changes, status: 'completed' })
    )
    expect(record).toMatchObject({ kind: 'file_change', status: 'completed' })
    const paths = record?.kind === 'file_change' ? record.paths : []
    expect(paths).toHaveLength(50)
    expect(paths[0]).toBe('src/file-0.ts')
  })

  it('keeps only the type and status of other items, never their arguments or results', () => {
    const records = [
      item('started', {
        id: 'mcp_1',
        type: 'mcp_tool_call',
        server: 'docs',
        tool: 'search',
        arguments: { query: 'ARGUMENT-SENTINEL' },
        status: 'in_progress'
      }),
      item('completed', { id: 'ws_1', type: 'web_search', query: 'QUERY-SENTINEL' }),
      item('updated', { id: 'td_1', type: 'todo_list', items: [{ text: 'TODO-SENTINEL' }] })
    ].flatMap(codexTranscriptRecords)
    expect(records).toEqual([
      { kind: 'tool', itemType: 'mcp_tool_call', status: 'in_progress' },
      { kind: 'tool', itemType: 'web_search', status: 'completed' },
      { kind: 'tool', itemType: 'todo_list', status: 'updated' }
    ])
    expect(JSON.stringify(records)).not.toMatch(/SENTINEL/)
  })

  it('never writes reasoning, in any phase or event name', () => {
    const reasoning = { id: 'r1', type: 'reasoning', text: 'REASONING-SENTINEL' }
    const lines = [
      item('started', reasoning),
      item('updated', reasoning),
      item('completed', reasoning),
      line({ type: 'reasoning.delta', text: 'REASONING-SENTINEL' })
    ]
    expect(lines.flatMap(codexTranscriptRecords)).toEqual([])
  })
})

describe('appendCodexStdoutLine and codexTranscriptStart', () => {
  it('appends every record a line maps to', () => {
    const records: TranscriptRecord[] = []
    const sink: TranscriptSink = { append: (record) => records.push(record), fault: () => {} }
    appendCodexStdoutLine(sink, line({ type: 'turn.started' }))
    expect(records).toEqual([{ kind: 'turn', phase: 'started', usage: null, error: null }])
  })

  it('reports the applied sandbox as read-only or write', () => {
    const applied = {
      model: 'gpt-6-astra',
      effort: 'high',
      ephemeral: false,
      outputSchema: false,
      skipGitRepoCheck: false
    } as const
    expect(codexTranscriptStart({ ...applied, sandbox: 'read-only' }, 'C:/repo')).toEqual({
      executor: 'codex',
      model: 'gpt-6-astra',
      effort: 'high',
      sandbox: 'read-only',
      cwd: 'C:/repo',
      worktree: null
    })
    expect(
      codexTranscriptStart({ ...applied, sandbox: 'workspace-write' }, 'C:/repo').sandbox
    ).toBe('write')
    // No --sandbox: codex exec's documented default is read-only.
    expect(codexTranscriptStart({ ...applied, sandbox: null }, 'C:/repo').sandbox).toBe('read-only')
  })

  it("names the attempt's own worktree when it has one (D-025)", () => {
    const applied = {
      model: 'gpt-6-astra',
      effort: 'high',
      sandbox: 'workspace-write',
      ephemeral: false,
      outputSchema: false,
      skipGitRepoCheck: false
    } as const
    const worktree = {
      branch: 'nash-task-1',
      path: 'C:/wt/nash-task-1',
      baseCommit: 'a'.repeat(40)
    }
    expect(codexTranscriptStart(applied, 'C:/wt/nash-task-1', worktree)).toMatchObject({
      sandbox: 'write',
      cwd: 'C:/wt/nash-task-1',
      worktree
    })
  })
})

import { describe, expect, it } from 'vitest'
import { evaluateCodexExecCompletion, type CodexExecCompletionInput } from './codex-exec-completion'
import type { JsonlLine } from './codex-exec-jsonl-line-reader'
import { createCodexExecStreamState } from './codex-exec-stream-state'

const THREAD = { type: 'thread.started', thread_id: 't-1' }
const TURN = { type: 'turn.started' }
const DONE = { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }

type Entry = Record<string, unknown> | JsonlLine

function isJsonlLine(entry: Entry): entry is JsonlLine {
  return 'kind' in entry && (entry.kind === 'line' || entry.kind === 'oversized')
}

function summaryOf(...events: readonly Entry[]) {
  const state = createCodexExecStreamState()
  let lineNumber = 0
  for (const entry of events) {
    lineNumber += 1
    state.acceptLine(
      isJsonlLine(entry) ? entry : { kind: 'line', text: JSON.stringify(entry), lineNumber }
    )
  }
  return state.summary()
}

function input(overrides: Partial<CodexExecCompletionInput> = {}): CodexExecCompletionInput {
  return {
    exitCode: 0,
    exitSignal: null,
    stream: summaryOf(THREAD, TURN, DONE),
    lastMessage: {
      state: 'ok',
      bytes: 12,
      sha256: 'a'.repeat(64),
      text: 'final answer',
      secretLike: false
    },
    schemaCheck: { kind: 'not_required' },
    stderrTail: '',
    descendantOutlivedRoot: false,
    ...overrides
  }
}

function kindsOf(verdict: ReturnType<typeof evaluateCodexExecCompletion>): string[] {
  return verdict.status === 'completed' ? [] : verdict.failures.map((failure) => failure.kind)
}

describe('evaluateCodexExecCompletion', () => {
  it('completes when every clause of the rule holds', () => {
    expect(evaluateCodexExecCompletion(input())).toEqual({ status: 'completed' })
  })

  it('completes with a validated schema', () => {
    expect(evaluateCodexExecCompletion(input({ schemaCheck: { kind: 'passed' } }))).toEqual({
      status: 'completed'
    })
  })

  it.each([
    ['a non-zero exit code', { exitCode: 1 }, ['nonzero_exit']],
    ['a signal exit', { exitCode: null, exitSignal: 'SIGKILL' as const }, ['nonzero_exit']],
    ['an unknown exit', { exitCode: null }, ['nonzero_exit']],
    ['no thread.started', { stream: summaryOf(TURN, DONE) }, ['missing_thread_started']],
    [
      'two thread.started',
      { stream: summaryOf(THREAD, { type: 'thread.started', thread_id: 't-2' }, TURN, DONE) },
      ['duplicate_thread_started']
    ],
    [
      'a turn.failed',
      { stream: summaryOf(THREAD, TURN, { type: 'turn.failed', error: { message: 'boom' } }) },
      ['turn_failed']
    ],
    [
      'an error event',
      { stream: summaryOf(THREAD, TURN, { type: 'error', message: 'boom' }, DONE) },
      ['error_event']
    ],
    [
      'an error event after completion',
      { stream: summaryOf(THREAD, TURN, DONE, { type: 'error', message: 'late' }) },
      ['error_event']
    ],
    ['no turn.completed', { stream: summaryOf(THREAD, TURN) }, ['missing_final_turn_completed']],
    [
      'an oversized control event',
      {
        stream: summaryOf(THREAD, TURN, {
          kind: 'oversized',
          lineNumber: 9,
          totalBytes: 99999,
          prefix: '{"type":"turn.completed","pad":"'
        })
      },
      ['oversized_control_event', 'missing_final_turn_completed']
    ],
    [
      'a corrupted control event line',
      {
        stream: summaryOf(THREAD, TURN, DONE, {
          kind: 'line',
          lineNumber: 9,
          text: '{"type":"error","message":"stream disc'
        })
      },
      ['malformed_control_event']
    ],
    [
      'an oversized line whose type could not be read',
      {
        stream: summaryOf(THREAD, TURN, DONE, {
          kind: 'oversized',
          lineNumber: 9,
          totalBytes: 99999,
          prefix: '{"item":{"pad":"'
        })
      },
      ['oversized_control_event']
    ],
    [
      'a helper that outlived the root',
      { descendantOutlivedRoot: true },
      ['descendant_outlived_root']
    ],
    [
      'a missing last message',
      { lastMessage: { state: 'missing' as const } },
      ['last_message_missing']
    ],
    [
      'an unreadable last message',
      { lastMessage: { state: 'unreadable' as const, code: 'EISDIR' } },
      ['last_message_missing']
    ],
    ['an empty last message', { lastMessage: { state: 'empty' as const } }, ['last_message_empty']],
    [
      'an oversized last message',
      { lastMessage: { state: 'oversized' as const, bytes: 99_999_999 } },
      ['last_message_oversized']
    ],
    [
      'an output that violates the schema',
      { schemaCheck: { kind: 'failed' as const, detail: 'status: invalid option' } },
      ['output_schema_violation']
    ],
    [
      'a schema that cannot be compiled',
      { schemaCheck: { kind: 'unvalidatable' as const, detail: 'not supported' } },
      ['schema_unvalidatable']
    ]
  ])('fails on %s', (_label, overrides, expected) => {
    expect(kindsOf(evaluateCodexExecCompletion(input(overrides)))).toEqual(expected)
  })

  it('lists every violated clause in a stable order, primary first', () => {
    const verdict = evaluateCodexExecCompletion(
      input({
        exitCode: 2,
        stream: summaryOf(TURN, { type: 'error', message: 'x' }),
        lastMessage: { state: 'empty' }
      })
    )
    expect(kindsOf(verdict)).toEqual([
      'nonzero_exit',
      'missing_thread_started',
      'error_event',
      'last_message_empty'
    ])
  })

  it('maps usage-limit text to blocked(quota), labelled heuristic, and keeps the failures', () => {
    const verdict = evaluateCodexExecCompletion(
      input({
        exitCode: 1,
        stream: summaryOf(THREAD, TURN, {
          type: 'turn.failed',
          error: { message: "You've hit your usage limit. Try again at 3:14 PM." }
        }),
        lastMessage: { state: 'missing' }
      })
    )
    expect(verdict).toMatchObject({ status: 'blocked', reason: 'quota', heuristic: true })
    expect(kindsOf(verdict)).toContain('turn_failed')
  })

  it('maps auth text found only on stderr to blocked(auth)', () => {
    const verdict = evaluateCodexExecCompletion(
      input({
        exitCode: 1,
        stream: summaryOf(),
        lastMessage: { state: 'missing' },
        stderrTail: 'ERROR: Not logged in. Run `codex login`.'
      })
    )
    expect(verdict).toMatchObject({ status: 'blocked', reason: 'auth', heuristic: true })
  })

  it('never turns an otherwise complete run into blocked because of stderr text', () => {
    expect(
      evaluateCodexExecCompletion(input({ stderrTail: 'warning: approaching your usage limit' }))
    ).toEqual({ status: 'completed' })
  })

  it('does not read agent message content as a block signal', () => {
    const stream = summaryOf(THREAD, TURN, {
      type: 'item.completed',
      item: { id: 'm', type: 'agent_message', text: 'the usage limit was documented' }
    })
    const verdict = evaluateCodexExecCompletion(input({ exitCode: 1, stream }))
    expect(verdict.status).toBe('failed')
  })
})

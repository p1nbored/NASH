import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFakeCodexRun,
  fakeEvents,
  successSteps,
  type FakeCodexRun,
  type FakeStep
} from './codex-exec-fake-codex.test-fixture'
import { runCodexExec, type CodexExecResult } from './codex-exec-run'

// FIXTURE_ONLY: every run below drives the scripted fake; no real codex binary starts.
const runs: FakeCodexRun[] = []

function fake(steps: readonly FakeStep[]): FakeCodexRun {
  const run = createFakeCodexRun(steps)
  runs.push(run)
  return run
}

afterEach(() => {
  for (const run of runs.splice(0)) {
    run.cleanup()
  }
})

function failureKinds(result: CodexExecResult): string[] {
  return result.verdict.status === 'completed'
    ? []
    : result.verdict.failures.map((failure) => failure.kind)
}

describe('runCodexExec typed failures', () => {
  it('turns a turn.failed into a typed failure', async () => {
    const run = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { event: { type: 'turn.failed', error: { message: 'model overloaded' } } },
      { exit: 1 }
    ])
    const result = await runCodexExec(run.request(), run.options())
    expect(result.verdict.status).toBe('failed')
    expect(failureKinds(result)).toEqual(['nonzero_exit', 'turn_failed', 'last_message_missing'])
    expect(result.exitCode).toBe(1)
    expect(result.stream.failureMessages).toEqual(['model overloaded'])
  })

  it('turns an error event into a typed failure even when the exit code is 0', async () => {
    const run = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { event: { type: 'error', message: 'stream disconnected' } },
      { lastMessage: 'looks fine' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const result = await runCodexExec(run.request(), run.options())
    expect(failureKinds(result)).toEqual(['error_event'])
    expect(result.exitCode).toBe(0)
  })

  it('fails a run with no thread.started', async () => {
    const run = fake([
      fakeEvents.turnStarted(),
      { lastMessage: 'x' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const result = await runCodexExec(run.request(), run.options())
    expect(failureKinds(result)).toEqual(['missing_thread_started'])
    expect(result.threadId).toBeNull()
  })

  it('fails a run with two thread.started events', async () => {
    const run = fake([
      fakeEvents.threadStarted('thread-a'),
      fakeEvents.threadStarted('thread-b'),
      fakeEvents.turnStarted(),
      { lastMessage: 'x' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const result = await runCodexExec(run.request(), run.options())
    expect(failureKinds(result)).toEqual(['duplicate_thread_started'])
    expect(result.threadStartedCount).toBe(2)
    expect(result.threadId).toBeNull()
  })

  it('fails a run whose turn never completes', async () => {
    const run = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { lastMessage: 'x' },
      { exit: 0 }
    ])
    const result = await runCodexExec(run.request(), run.options())
    expect(failureKinds(result)).toEqual(['missing_final_turn_completed'])
  })

  it('fails an empty or whitespace-only last message', async () => {
    for (const content of ['', '  \r\n\t ']) {
      const run = fake([
        fakeEvents.threadStarted(),
        fakeEvents.turnStarted(),
        { lastMessage: content },
        fakeEvents.turnCompleted(),
        { exit: 0 }
      ])
      const result = await runCodexExec(run.request(), run.options())
      expect(failureKinds(result)).toEqual(['last_message_empty'])
      expect(result.lastMessage.state).toBe('empty')
    }
  })

  it('fails a last message above the size cap without reading it whole', async () => {
    const run = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { lastMessage: 'x'.repeat(4096) },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const result = await runCodexExec(
      run.request(),
      run.options({ limits: { maxLastMessageBytes: 1024 } })
    )
    expect(failureKinds(result)).toEqual(['last_message_oversized'])
  })

  it('records malformed lines as flags without failing an otherwise complete run', async () => {
    const run = fake([
      fakeEvents.threadStarted(),
      { stdout: 'Reading prompt from stdin...\n' },
      { stdout: '{"type":"turn.started"\n' },
      { stdout: '[1,2,3]\n' },
      { stdout: '{"no_type":true}\n' },
      { stdout: '\n   \n' },
      fakeEvents.turnStarted(),
      { lastMessage: 'ok' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const result = await runCodexExec(run.request(), run.options())
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.stream.nonJsonLineCount).toBe(4)
    expect(result.stream.nonJsonLines.map((entry) => entry.reason)).toEqual([
      'invalid_json',
      'invalid_json',
      'not_an_object',
      'missing_type'
    ])
    expect(result.stream.nonJsonLines[0]?.lineNumber).toBe(2)
  })

  it('fails closed on a corrupted line that names a control event', async () => {
    const run = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { stdout: '{"type":"error","message":"stream disc\n' },
      { lastMessage: 'ok' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const result = await runCodexExec(run.request(), run.options())
    expect(failureKinds(result)).toEqual(['malformed_control_event'])
  })

  it('flags an oversized line, keeps parsing, and fails only if a control event may have been lost', async () => {
    const benign = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { bigLine: 8000 },
      { lastMessage: 'ok' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const ok = await runCodexExec(
      benign.request(),
      benign.options({ limits: { maxLineBytes: 1024 } })
    )
    expect(ok.verdict).toEqual({ status: 'completed' })
    expect(ok.stream.oversizedLineCount).toBe(1)
    expect(ok.stream.oversizedLines[0]).toMatchObject({ typeHint: 'item.completed' })
    expect(ok.stdoutBytes).toBeGreaterThan(8000)

    const lost = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { bigLine: 8000, bigLineType: 'turn.completed' },
      { lastMessage: 'ok' },
      { exit: 0 }
    ])
    const failed = await runCodexExec(
      lost.request(),
      lost.options({ limits: { maxLineBytes: 1024 } })
    )
    expect(failureKinds(failed)).toEqual([
      'oversized_control_event',
      'missing_final_turn_completed'
    ])
  })

  it('fails closed on an oversized line whose type cannot be read', async () => {
    const run = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { stdout: `{"payload":"${'x'.repeat(4000)}","type":"turn.completed"}\n` },
      { lastMessage: 'ok' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const result = await runCodexExec(
      run.request(),
      run.options({ limits: { maxLineBytes: 1024 } })
    )
    expect(failureKinds(result)).toEqual(['oversized_control_event'])
  })

  it('reports a usage-limit failure as blocked(quota), labelled heuristic', async () => {
    const run = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { event: { type: 'error', message: "You've hit your usage limit. Try again at 3:14 PM." } },
      {
        event: {
          type: 'turn.failed',
          error: { message: "You've hit your usage limit. Try again at 3:14 PM." }
        }
      },
      { exit: 1 }
    ])
    const result = await runCodexExec(run.request(), run.options())
    expect(result.verdict).toMatchObject({ status: 'blocked', reason: 'quota', heuristic: true })
    expect(failureKinds(result)).toContain('turn_failed')
  })

  it('reports not-logged-in text on stderr as blocked(auth)', async () => {
    const run = fake([
      { stderr: 'ERROR: Not logged in. Run `codex login` to authenticate.\n' },
      { exit: 1 }
    ])
    const result = await runCodexExec(run.request(), run.options())
    expect(result.verdict).toMatchObject({ status: 'blocked', reason: 'auth', heuristic: true })
    expect(result.stderrTail).toContain('Not logged in')
  })

  it('keeps stderr in a bounded, redacted ring', async () => {
    const run = fake([
      { stderr: `sk-FIXTUREONLY1234567890abcdef ${'e'.repeat(5000)} tail-marker\n` },
      ...successSteps()
    ])
    const result = await runCodexExec(
      run.request(),
      run.options({ limits: { maxStderrBytes: 512 } })
    )
    expect(result.verdict.status).toBe('completed')
    expect(result.stderrTail.length).toBeLessThanOrEqual(512)
    expect(result.stderrTail).toContain('tail-marker')
    expect(result.stderrTail).not.toContain('sk-FIXTUREONLY1234567890abcdef')
    expect(result.stderrTruncated).toBe(true)
  })

  it('reports a non-zero exit with no events at all', async () => {
    const run = fake([{ exit: 7 }])
    const result = await runCodexExec(run.request(), run.options())
    expect(failureKinds(result)).toEqual([
      'nonzero_exit',
      'missing_thread_started',
      'missing_final_turn_completed',
      'last_message_missing'
    ])
    expect(result.exitCode).toBe(7)
  })

  it('reports a spawn failure as a typed failure instead of rejecting', async () => {
    const run = fake(successSteps())
    const missingNode = join(run.root, 'no-such-node.exe')
    const result = await runCodexExec(
      run.request(),
      run.options({ executable: { ...run.executable, program: missingNode } })
    )
    expect(failureKinds(result)).toEqual(['spawn_failed'])
    expect(result.spawned).toBe(false)
    expect(result.exitCode).toBeNull()
    expect(result.treeProof).toEqual({ verdict: 'exited', method: 'not_started' })
  })
})

describe('runCodexExec request validation', () => {
  const invalid: readonly (readonly [string, Record<string, unknown>])[] = [
    ['effort extreme', { effort: 'extreme' }],
    ['effort MAX', { effort: 'MAX' }],
    ['sandbox danger-full-access', { sandbox: 'danger-full-access' }],
    ['a relative worktree', { worktreePath: 'relative/worktree' }],
    ['a missing worktree', { worktreePath: join('Z:', 'definitely', 'missing', 'worktree') }],
    ['a bad model slug', { model: '--full-auto' }],
    ['a non-string model', { model: 5 }],
    ['an empty prompt', { prompt: '' }],
    ['a whitespace prompt', { prompt: ' \n ' }],
    ['a NUL in the prompt', { prompt: 'abc\u0000def' }],
    ['a relative runs root', { runsRoot: 'runs/one' }],
    ['a run id with a path separator', { runId: 'a/b' }],
    ['a truthy non-boolean ephemeral flag', { ephemeral: 'false' }]
  ]

  it.each(invalid)('refuses %s without starting a process', async (_label, overrides) => {
    const run = fake(successSteps())
    const result = await runCodexExec(run.request(overrides), run.options())
    expect(result.verdict).toMatchObject({
      status: 'failed',
      failures: [{ kind: 'invalid_request' }]
    })
    expect(result.spawned).toBe(false)
    expect(result.applied).toBeNull()
    expect(run.received()).toBeNull()
    expect(result.argv).toEqual([])
  })

  it('refuses a prompt above the size cap', async () => {
    const run = fake(successSteps())
    const result = await runCodexExec(
      run.request({ prompt: 'p'.repeat(2048) }),
      run.options({ limits: { maxPromptBytes: 1024 } })
    )
    expect(failureKinds(result)).toEqual(['invalid_request'])
    expect(run.received()).toBeNull()
  })

  it.each([
    ['an infinite timeout', { timeoutMs: Number.POSITIVE_INFINITY }],
    ['a zero line cap', { limits: { maxLineBytes: 0 } }],
    ['a timeout above the timer maximum', { timeoutMs: 2 ** 31 }]
  ])('refuses %s before anything is created', async (_label, overrides) => {
    const run = fake(successSteps())
    const result = await runCodexExec(run.request(), run.options(overrides))
    expect(failureKinds(result)).toEqual(['invalid_request'])
    expect(result.spawned).toBe(false)
    expect(run.received()).toBeNull()
  })

  it('does not let an explicit undefined line cap switch the cap off', async () => {
    const run = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { bigLine: 2 * 1024 * 1024 },
      { lastMessage: 'ok' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const result = await runCodexExec(
      run.request(),
      run.options({ limits: { maxLineBytes: undefined } })
    )
    expect(result.stream.oversizedLineCount).toBe(1)
  })
})

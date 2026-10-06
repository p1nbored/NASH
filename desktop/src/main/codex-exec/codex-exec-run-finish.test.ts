import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChildSessionOutcome } from './codex-exec-child-session'
import { compileOutputSchema } from './codex-exec-output-schema'
import {
  abortedBeforeStart,
  finishCodexExecRun,
  startRunClock,
  type FinishInput
} from './codex-exec-run-finish'
import { DEFAULT_CODEX_EXEC_LIMITS } from './codex-exec-run-options'
import type { PreparedCodexExecRun } from './codex-exec-run-preparation'
import { createCodexExecStreamState } from './codex-exec-stream-state'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codex-exec-finish-'))
  mkdirSync(join(dir, 'tmp'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function stream(lines: readonly object[]) {
  const state = createCodexExecStreamState()
  lines.forEach((line, index) =>
    state.acceptLine({ kind: 'line', text: JSON.stringify(line), lineNumber: index + 1 })
  )
  return state.summary()
}

const CLEAN_STREAM = [
  { type: 'thread.started', thread_id: 't-1' },
  { type: 'turn.started' },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }
]

function run(schema: PreparedCodexExecRun['schema'] = null): PreparedCodexExecRun {
  return {
    applied: {
      model: 'gpt-6-astra',
      effort: 'high',
      sandbox: 'read-only',
      ephemeral: false,
      outputSchema: schema !== null,
      skipGitRepoCheck: false
    },
    argv: ['exec'],
    prompt: 'p',
    worktreePath: join(dir, 'wt'),
    location: {
      runDir: dir,
      tempDir: join(dir, 'tmp'),
      lastMessagePath: join(dir, 'last-message.txt'),
      schemaPath: join(dir, 'result.schema.json')
    },
    schema
  }
}

function ranSession(overrides: Partial<Extract<ChildSessionOutcome, { kind: 'ran' }>> = {}) {
  return {
    kind: 'ran',
    exitCode: 0,
    exitSignal: null,
    stream: stream(CLEAN_STREAM),
    stdoutBytes: 10,
    stderrTail: '',
    stderrTruncated: false,
    stdoutDrainTimedOut: false,
    descendantOutlivedRoot: false,
    termination: null,
    treeProof: { verdict: 'exited', method: 'posix_group_probe' },
    listenerErrorCount: 0,
    ...overrides
  } satisfies ChildSessionOutcome
}

function finishInput(session: ChildSessionOutcome, prepared = run()): FinishInput {
  return {
    clock: startRunClock(),
    run: prepared,
    plan: { env: {}, envNames: [], evidence: null, versionProbeStarted: false },
    limits: DEFAULT_CODEX_EXEC_LIMITS,
    session
  }
}

function kinds(result: Awaited<ReturnType<typeof finishCodexExecRun>>): string[] {
  return result.verdict.status === 'completed'
    ? []
    : result.verdict.failures.map((failure) => failure.kind)
}

describe('finishCodexExecRun', () => {
  it('judges a clean session by the completion rule and reads the last message', async () => {
    writeFileSync(join(dir, 'last-message.txt'), 'all done')
    const result = await finishCodexExecRun(finishInput(ranSession()))
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.lastMessage).toMatchObject({ state: 'ok', bytes: 8, secretLike: false })
  })

  it('never returns completed when a helper outlived the root, even after a proven sweep', async () => {
    writeFileSync(join(dir, 'last-message.txt'), 'all done')
    const session = ranSession({
      stdoutDrainTimedOut: true,
      descendantOutlivedRoot: true,
      termination: {
        trigger: 'drain_timeout',
        outcome: {
          verdict: 'exited',
          method: 'posix_group_quiescence',
          rootExited: true,
          escalatedToForce: true
        }
      },
      treeProof: { verdict: 'exited', method: 'posix_group_quiescence' }
    })
    const result = await finishCodexExecRun(finishInput(session))
    expect(kinds(result)).toEqual(['descendant_outlived_root'])
    expect(result.treeProof).toEqual({ verdict: 'exited', method: 'posix_group_quiescence' })
    expect(result.stdoutDrainTimedOut).toBe(true)
    expect(result.cancellation).toEqual({ requested: false })
  })

  it('reports an abort that landed after the root exited as cancelled, with the tree it proved', async () => {
    writeFileSync(join(dir, 'last-message.txt'), 'all done')
    const session = ranSession({
      termination: {
        trigger: 'abort_signal',
        outcome: {
          verdict: 'unverifiable',
          method: 'root_exit_only',
          rootExited: true,
          escalatedToForce: false
        }
      },
      treeProof: { verdict: 'unverifiable', method: 'root_exit_only' }
    })
    const result = await finishCodexExecRun(finishInput(session))
    expect(kinds(result)).toEqual(['cancelled'])
    expect(result.cancellation).toMatchObject({
      requested: true,
      trigger: 'abort_signal',
      verdict: 'unverifiable',
      method: 'root_exit_only',
      rootExited: true
    })
    expect(JSON.stringify(result.verdict)).toContain('root_exit_only')
    expect(result.lastMessage.state).toBe('not_read')
  })

  it('labels a timeout as timed_out', async () => {
    const session = ranSession({
      termination: {
        trigger: 'timeout',
        outcome: {
          verdict: 'live',
          method: 'posix_group_quiescence',
          rootExited: false,
          escalatedToForce: true
        }
      },
      treeProof: { verdict: 'live', method: 'posix_group_quiescence' }
    })
    const result = await finishCodexExecRun(finishInput(session))
    expect(kinds(result)).toEqual(['timed_out'])
    expect(result.treeProof.verdict).toBe('live')
  })

  it('reports a spawn failure as typed and never as a stopped run', async () => {
    const result = await finishCodexExecRun(
      finishInput({ kind: 'not_started', spawnError: 'spawn ENOENT' })
    )
    expect(kinds(result)).toEqual(['spawn_failed'])
    expect(result.spawned).toBe(false)
    expect(result.treeProof).toEqual({ verdict: 'exited', method: 'not_started' })
  })

  it('maps a validator that cannot judge the message to schema_unvalidatable, not a violation', async () => {
    const compiled = compileOutputSchema(
      { type: 'object', properties: { a: { $ref: '#' } } },
      { maxValueDepth: 1_000_000 }
    )
    if (!compiled.ok) {
      throw new Error('schema should compile')
    }
    writeFileSync(join(dir, 'last-message.txt'), `${'{"a":'.repeat(60_000)}{}${'}'.repeat(60_000)}`)
    const result = await finishCodexExecRun(finishInput(ranSession(), run(compiled)))
    expect(kinds(result)).toEqual(['schema_unvalidatable'])
  })
})

describe('abortedBeforeStart', () => {
  const plan = (versionProbeStarted: boolean) => ({
    env: {},
    envNames: [],
    evidence: null,
    versionProbeStarted
  })

  it('says nothing ever ran when no probe was started', () => {
    const result = abortedBeforeStart(startRunClock(), run(), plan(false))
    expect(result.cancellation).toMatchObject({
      requested: true,
      spawned: false,
      verdict: 'exited',
      method: 'not_started'
    })
  })

  it('does not claim a clean exit when the version probe may still have been running', () => {
    const result = abortedBeforeStart(startRunClock(), run(), plan(true))
    expect(result.cancellation).toMatchObject({
      verdict: 'unverifiable',
      method: 'version_probe_unproven'
    })
    expect(result.treeProof).toEqual({ verdict: 'unverifiable', method: 'version_probe_unproven' })
    expect(result.spawned).toBe(false)
  })
})

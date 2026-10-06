import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TranscriptFileHandle } from '../agent-exec-shared/attempt-transcript'
import {
  createFakeCodexRun,
  fakeEvents,
  successSteps,
  type FakeCodexRun,
  type FakeStep
} from './codex-exec-fake-codex.test-fixture'
import { runCodexExec } from './codex-exec-run'

// FIXTURE_ONLY: every run drives the scripted fake codex; the secret below is synthetic.
const SECRET = 'sk-FIXTUREONLY1234567890abcdef'
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

const transcriptOf = (run: FakeCodexRun) => ({ path: join(run.runDir, 'transcript.jsonl') })

function readTranscript(run: FakeCodexRun): Record<string, unknown>[] {
  return readFileSync(join(run.runDir, 'transcript.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))
}

const command = (phase: string, extra: Record<string, unknown>) => ({
  event: {
    type: `item.${phase}`,
    item: { id: 'cmd_1', type: 'command_execution', command: 'git status', ...extra }
  }
})

function workingSteps(): readonly FakeStep[] {
  return [
    fakeEvents.threadStarted(),
    fakeEvents.turnStarted(),
    fakeEvents.reasoning(),
    command('started', { aggregated_output: '', exit_code: null, status: 'in_progress' }),
    command('completed', {
      aggregated_output: 'On branch main\n',
      exit_code: 0,
      status: 'completed'
    }),
    { stderr: 'warning: first\nwarning: second\n' },
    {
      event: {
        type: 'item.completed',
        item: {
          id: 'fc_1',
          type: 'file_change',
          changes: [{ path: 'src/a.ts', kind: 'update' }],
          status: 'completed'
        }
      }
    },
    fakeEvents.agentMessage('final answer'),
    { lastMessage: 'final answer' },
    fakeEvents.turnCompleted(),
    { exit: 0 }
  ]
}

describe('runCodexExec transcript', () => {
  it('writes what the CLI does from start to end, without reasoning', async () => {
    const run = fake(workingSteps())
    const result = await runCodexExec(run.request(), run.options({ transcript: transcriptOf(run) }))

    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.transcript).toEqual({
      errorCode: null,
      errorCount: 0,
      droppedRecords: 0,
      truncated: false,
      retention: { deleted: 0, errors: 0 }
    })
    const lines = readTranscript(run)
    expect(lines[0]).toMatchObject({
      v: 1,
      seq: 0,
      kind: 'start',
      executor: 'codex',
      model: 'gpt-6-astra',
      effort: 'high',
      sandbox: 'read-only',
      cwd: run.worktree,
      worktree: null
    })
    expect(lines.at(-1)).toMatchObject({
      kind: 'end',
      state: 'completed',
      exitCode: 0,
      reasonCode: null
    })
    expect(lines.map((line) => line.seq)).toEqual(lines.map((_, index) => index))
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'turn', phase: 'started' }),
        expect.objectContaining({ kind: 'command', status: 'started', command: 'git status' }),
        expect.objectContaining({
          kind: 'command',
          status: 'completed',
          exitCode: 0,
          output: 'On branch main\n'
        }),
        expect.objectContaining({ kind: 'output', stream: 'stderr', text: 'warning: first' }),
        expect.objectContaining({ kind: 'output', stream: 'stderr', text: 'warning: second' }),
        expect.objectContaining({ kind: 'file_change', paths: ['src/a.ts'] }),
        expect.objectContaining({ kind: 'message', text: 'final answer' }),
        expect.objectContaining({ kind: 'turn', phase: 'completed' })
      ])
    )
    expect(readFileSync(join(run.runDir, 'transcript.jsonl'), 'utf8')).not.toContain(
      'REASONING-SENTINEL'
    )
    // The run record carries counts only; what the CLI printed stays in the file.
    expect(JSON.stringify(result)).not.toContain('On branch main')
  })

  it('records a write run and its own worktree in the start record (D-025)', async () => {
    const run = fake(successSteps('final answer'))
    const worktree = { branch: 'nash-task-1', path: run.worktree, baseCommit: 'a'.repeat(40) }
    await runCodexExec(
      run.request({ sandbox: 'workspace-write' }),
      run.options({ transcript: { ...transcriptOf(run), worktree } })
    )
    expect(readTranscript(run)[0]).toMatchObject({ kind: 'start', sandbox: 'write', worktree })
  })

  it('redacts a secret split across stdout chunks and across stderr writes', async () => {
    const message = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_1', type: 'agent_message', text: `key ${SECRET} end` }
    })
    const cut = message.indexOf('1234567890')
    const run = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { stdoutParts: [message.slice(0, cut), `${message.slice(cut)}\n`], gapMs: 40 },
      { stderr: 'token sk-FIXTUREONLY12' },
      { delayMs: 40 },
      { stderr: '34567890abcdef here\n' },
      { lastMessage: 'done' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    await runCodexExec(run.request(), run.options({ transcript: transcriptOf(run) }))
    const text = readFileSync(join(run.runDir, 'transcript.jsonl'), 'utf8')
    expect(text).not.toContain('FIXTUREONLY')
    expect(text).toContain('[redacted]')
  })

  it('ends with the failure code when the run fails', async () => {
    const run = fake([{ stderr: 'boom\n' }, { exit: 3 }])
    const result = await runCodexExec(run.request(), run.options({ transcript: transcriptOf(run) }))
    expect(result.verdict.status).toBe('failed')
    const end = readTranscript(run).at(-1)
    expect(end).toMatchObject({ kind: 'end', state: 'failed', exitCode: 3 })
    expect(typeof end?.reasonCode).toBe('string')
  })

  it('never fails the run when the transcript cannot be written, and reports a code only', async () => {
    const run = fake(successSteps())
    const broken: TranscriptFileHandle = {
      write: async () => {
        throw new Error(`ENOSPC at ${run.runDir}`)
      },
      close: async () => {}
    }
    const result = await runCodexExec(
      run.request(),
      run.options({
        transcript: transcriptOf(run),
        deps: { transcript: { open: async () => broken } }
      })
    )
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.transcript).toMatchObject({ errorCode: 'transcript_write_failed' })
    expect(JSON.stringify(result.transcript)).not.toContain('ENOSPC')
  })

  it('writes nothing when no transcript is asked for, or one outside the run directory', async () => {
    const plain = fake(successSteps())
    const result = await runCodexExec(plain.request(), plain.options())
    expect(result.transcript).toBeNull()
    expect(existsSync(join(plain.runDir, 'transcript.jsonl'))).toBe(false)

    const misplaced = fake(successSteps())
    const refused = await runCodexExec(
      misplaced.request(),
      misplaced.options({ transcript: { path: join(misplaced.root, 'transcript.jsonl') } })
    )
    expect(refused.verdict).toEqual({ status: 'completed' })
    expect(refused.transcript).toMatchObject({ errorCode: 'transcript_path_invalid' })
    expect(existsSync(join(misplaced.root, 'transcript.jsonl'))).toBe(false)
  })
})

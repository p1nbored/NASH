import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TranscriptFileHandle } from '../agent-exec-shared/attempt-transcript'
import {
  createFakeAgyRun,
  successSteps,
  type FakeAgyRun,
  type FakeStep
} from './agy-exec-fake-agy.test-fixture'
import { runAgyExec } from './agy-exec-run'

// FIXTURE_ONLY: every run drives the scripted fake agy; the secret below is synthetic.
const runs: FakeAgyRun[] = []

function fake(steps: readonly FakeStep[]): FakeAgyRun {
  const run = createFakeAgyRun(steps)
  runs.push(run)
  return run
}

afterEach(() => {
  for (const run of runs.splice(0)) {
    run.cleanup()
  }
})

const transcriptOf = (run: FakeAgyRun) => ({ path: join(run.runDir, 'transcript.jsonl') })

function readTranscript(run: FakeAgyRun): Record<string, unknown>[] {
  return readFileSync(join(run.runDir, 'transcript.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))
}

describe('runAgyExec transcript', () => {
  it('writes one output record per line of stdout and stderr between start and end', async () => {
    const run = fake([
      { stdout: '# Draft\n\nline two\n' },
      { stderr: 'warn: slow\n' },
      { delayMs: 30 },
      { stdout: 'tail without newline' },
      { exit: 0 }
    ])
    const result = await runAgyExec(run.request(), run.options({ transcript: transcriptOf(run) }))

    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.transcript).toMatchObject({ errorCode: null, errorCount: 0, droppedRecords: 0 })
    const lines = readTranscript(run)
    expect(lines[0]).toMatchObject({
      v: 1,
      seq: 0,
      kind: 'start',
      executor: 'agy',
      model: 'gemini-3.8-flash-high',
      effort: null,
      sandbox: 'read-only',
      cwd: run.worktree,
      worktree: null
    })
    expect(lines.at(-1)).toMatchObject({ kind: 'end', state: 'completed', exitCode: 0 })
    expect(lines.map((line) => line.seq)).toEqual(lines.map((_, index) => index))
    const stdout = lines.filter((line) => line.kind === 'output' && line.stream === 'stdout')
    expect(stdout.map((line) => line.text)).toEqual([
      '# Draft',
      '',
      'line two',
      'tail without newline'
    ])
    expect(lines).toContainEqual(
      expect.objectContaining({ kind: 'output', stream: 'stderr', text: 'warn: slow' })
    )
    // The outcome is counts and a code; the lines stay in the file (the answer preview is separate).
    expect(JSON.stringify(result.transcript)).not.toMatch(/line two|warn: slow/)
  })

  it('records a write run and its own worktree in the start record (D-025)', async () => {
    const run = fake(successSteps())
    const worktree = { branch: 'nash-task-1', path: run.worktree, baseCommit: 'a'.repeat(40) }
    await runAgyExec(
      run.request({ sandbox: false }),
      run.options({ transcript: { ...transcriptOf(run), worktree } })
    )
    expect(readTranscript(run)[0]).toMatchObject({ kind: 'start', sandbox: 'write', worktree })
  })

  it('redacts a secret split across two stdout chunks', async () => {
    const run = fake([
      { stdoutParts: ['answer sk-FIXTUREONLY12', '34567890abcdef done\n'], gapMs: 40 },
      { exit: 0 }
    ])
    await runAgyExec(run.request(), run.options({ transcript: transcriptOf(run) }))
    const text = readFileSync(join(run.runDir, 'transcript.jsonl'), 'utf8')
    expect(text).not.toContain('FIXTUREONLY')
    expect(text).toContain('[redacted]')
  })

  it('never fails the run when the transcript cannot be written', async () => {
    const run = fake(successSteps())
    const broken: TranscriptFileHandle = {
      write: async () => {
        throw new Error('EIO')
      },
      close: async () => {}
    }
    const result = await runAgyExec(
      run.request(),
      run.options({
        transcript: transcriptOf(run),
        deps: { transcript: { open: async () => broken } }
      })
    )
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.transcript).toMatchObject({ errorCode: 'transcript_write_failed' })
  })

  it('writes nothing when no transcript is asked for', async () => {
    const run = fake(successSteps())
    const result = await runAgyExec(run.request(), run.options())
    expect(result.transcript).toBeNull()
    expect(existsSync(join(run.runDir, 'transcript.jsonl'))).toBe(false)
  })
})

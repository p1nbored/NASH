// FIXTURE_ONLY: a fake runner and a scripted fake agy; no real agy CLI, model or credential is used.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AgyExecutable } from '../../agy-exec/agy-exec-executable'
import {
  createFakeAgyRun,
  successSteps,
  type FakeAgyRun
} from '../../agy-exec/agy-exec-fake-agy.test-fixture'
import type { AgyExecResult } from '../../agy-exec/agy-exec-result'
import { runAgyExec } from '../../agy-exec/agy-exec-run'
import type { AgyExecRunOptions } from '../../agy-exec/agy-exec-run-options'
import type { AgyExecRequest } from '../../agy-exec/agy-exec-types'
import { agyRunReport, createAgyTaskExecutor } from './agy-task-executor'
import { AttemptWorktreeError, type AttemptWorktreePort } from './attempt-worktree'
import type { ProcessAttemptPlan } from './process-executor-contract'

const EXECUTABLE: AgyExecutable = {
  program: 'C:/fixture/agy/bin/agy.exe',
  prefixArgs: [],
  entryPath: 'C:/fixture/agy/bin/agy.exe',
  requestedPath: 'C:/fixture/agy/bin/agy.exe',
  launch: 'direct',
  source: 'path-search'
}
const ReceivedSchema = z.object({ argv: z.array(z.string()) })
const OBJECTIVE = 'Draft a short alternative release note.'
const WORKTREE = {
  worktreeId: 'fixture-repo::C:/fixture/workspaces/nash-task_0123456789ab-ctx_0123456789ab',
  branch: 'nash-task_0123456789ab-ctx_0123456789ab',
  path: 'C:/fixture/workspaces/nash-task_0123456789ab-ctx_0123456789ab',
  baseCommit: '0123456789abcdef0123456789abcdef01234567'
}

function worktreePort(create: AttemptWorktreePort['create'] = async () => WORKTREE) {
  return { create: vi.fn(create) }
}

function plan(overrides: Partial<ProcessAttemptPlan> = {}): ProcessAttemptPlan {
  return {
    dispatchId: 'ctx_0123456789ab',
    runId: 'run_0123456789ab',
    taskId: 'task_0123456789ab',
    workspaceId: 'fixture-repo::C:/fixture/repo',
    access: 'read_only',
    cli: { model: 'gemini-3.8-flash-high', effort: null },
    prompt: {
      taskId: 'task_0123456789ab',
      dispatchId: 'ctx_0123456789ab',
      objective: OBJECTIVE,
      expectedOutputs: [],
      acceptanceCriteria: [],
      constraints: []
    },
    ...overrides
  }
}

function agyResult(overrides: Partial<AgyExecResult> = {}): AgyExecResult {
  return {
    verdict: { status: 'completed' },
    spawned: true,
    exitCode: 0,
    exitSignal: null,
    applied: { model: 'gemini-3.8-flash-high', effort: null },
    timing: { startedAt: '2026-10-05T12:00:00.000Z', durationMs: 900 },
    evidence: null,
    runDir: 'C:/fixture/runs/ctx_0123456789ab',
    output: {
      state: 'ok',
      path: 'C:/fixture/runs/ctx_0123456789ab/output.txt',
      bytes: 64,
      sha256: 'b'.repeat(64),
      secretLike: false,
      preview: 'PREVIEW-SENTINEL',
      previewTruncated: false
    },
    stdoutBytes: 64,
    stdoutDrainTimedOut: false,
    stderrTail: '',
    stderrTruncated: false,
    cancellation: { requested: false },
    treeProof: { verdict: 'unverifiable', method: 'root_exit_only' },
    argv: [],
    envNames: [],
    transcript: null,
    ...overrides
  }
}

function executor(overrides: Partial<Parameters<typeof createAgyTaskExecutor>[0]> = {}) {
  const run = vi.fn(async (_request: AgyExecRequest, _options: AgyExecRunOptions) => agyResult())
  const worktrees = worktreePort()
  const agy = createAgyTaskExecutor({
    run,
    resolveExecutable: () => EXECUTABLE,
    workspacePath: () => 'C:/fixture/repo',
    runsRoot: async (runId: string) => `C:/fixture/userData/autopilot-runs/${runId}`,
    worktrees,
    ...overrides
  })
  return { run, worktrees, agy }
}

async function prepared(agy: ReturnType<typeof executor>['agy'], input = plan()) {
  const outcome = await agy.prepare(input)
  if (!outcome.ok) {
    throw new Error(`prepare refused: ${outcome.reason}`)
  }
  return outcome.prepared
}

describe('agy task executor', () => {
  it('never sends an effort: the variant id carries it', async () => {
    const { run, agy } = executor()
    const ready = await prepared(
      agy,
      plan({ cli: { model: 'gemini-3.8-flash-high', effort: 'high' } })
    )
    await ready.run(new AbortController().signal)
    const [request, options] = run.mock.calls[0] ?? []
    expect(request).toBeDefined()
    expect(Object.keys(request ?? {})).not.toContain('effort')
    expect(request).toMatchObject({
      model: 'gemini-3.8-flash-high',
      sandbox: true,
      worktreePath: 'C:/fixture/repo',
      runsRoot: 'C:/fixture/userData/autopilot-runs/run_0123456789ab',
      runId: 'ctx_0123456789ab'
    })
    expect(request?.prompt).toContain(OBJECTIVE)
    expect(options).toMatchObject({ executable: EXECUTABLE })
    // D-027: no fixed timeout; the run ends when agy ends or the user stops it.
    expect(options?.timeoutMs).toBeUndefined()
  })

  it('runs a write attempt without --sandbox in its own new worktree, adding no other flag (D-025)', async () => {
    const { run, worktrees, agy } = executor()
    const ready = await prepared(agy, plan({ access: 'workspace_write' }))
    expect(worktrees.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ executor: 'agy_cli', runWorktreePath: 'C:/fixture/repo' })
    )
    expect(ready.placement).toEqual({ mode: 'own_worktree', worktree: WORKTREE })
    await ready.run(new AbortController().signal)
    const [request, options] = run.mock.calls[0] ?? []
    expect(request).toMatchObject({ sandbox: false, worktreePath: WORKTREE.path })
    expect(request?.prompt).not.toMatch(/read-only/)
    expect(request?.prompt).toMatch(/may change files/)
    expect(Object.keys(request ?? {}).sort()).toEqual(
      ['model', 'prompt', 'runId', 'runsRoot', 'sandbox', 'worktreePath'].sort()
    )
    expect(options?.transcript).toMatchObject({
      worktree: { branch: WORKTREE.branch, path: WORKTREE.path, baseCommit: WORKTREE.baseCommit }
    })
    expect(ready.evidence).toMatchObject({
      attemptWorkspace: { mode: 'own_worktree', ...WORKTREE }
    })
  })

  it('writes in the folder itself in a folder workspace, with no worktree (D-025)', async () => {
    const { run, worktrees, agy } = executor()
    const ready = await prepared(
      agy,
      plan({ access: 'workspace_write', workspaceId: 'folder:fixture-folder' })
    )
    expect(ready.placement).toEqual({ mode: 'folder' })
    await ready.run(new AbortController().signal)
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      sandbox: false,
      worktreePath: 'C:/fixture/repo'
    })
    expect(worktrees.create).not.toHaveBeenCalled()
  })

  it('refuses the start, with nothing run, when its worktree cannot be created', async () => {
    const { run, agy } = executor({
      worktrees: worktreePort(async () => {
        throw new AttemptWorktreeError('not_local')
      })
    })
    await expect(agy.prepare(plan({ access: 'workspace_write' }))).resolves.toEqual({
      ok: false,
      reason: 'task_worktree_not_local'
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('writes the attempt transcript beside its other run files', async () => {
    const { run, agy } = executor()
    const ready = await prepared(agy)
    await ready.run(new AbortController().signal)
    const [, options] = run.mock.calls[0] ?? []
    expect(options?.transcript).toEqual({
      path: join(
        'C:/fixture/userData/autopilot-runs/run_0123456789ab',
        'ctx_0123456789ab',
        'transcript.jsonl'
      )
    })
  })

  it('passes an explicitly configured timeout through', async () => {
    const { run, agy } = executor({ timeoutMs: 90_000 })
    const ready = await prepared(agy)
    await ready.run(new AbortController().signal)
    expect(run.mock.calls[0]?.[1]?.timeoutMs).toBe(90_000)
  })

  it('takes a prompt past the old 12,000 character cap (D-027)', async () => {
    const { agy } = executor()
    const long = plan({ prompt: { ...plan().prompt, objective: 'x'.repeat(20_000) } })
    await expect(agy.prepare(long)).resolves.toMatchObject({ ok: true })
  })

  it('refuses a prompt the command line cannot hold, before anything starts', async () => {
    const { run, agy } = executor()
    const long = plan({ prompt: { ...plan().prompt, objective: 'x'.repeat(140_000) } })
    await expect(agy.prepare(long)).resolves.toEqual({ ok: false, reason: 'prompt_too_long' })
    expect(run).not.toHaveBeenCalled()
  })

  it('creates no worktree for a prompt the command line cannot hold', async () => {
    const { worktrees, agy } = executor()
    const long = plan({
      access: 'workspace_write',
      prompt: { ...plan().prompt, objective: 'x'.repeat(140_000) }
    })
    await expect(agy.prepare(long)).resolves.toEqual({ ok: false, reason: 'prompt_too_long' })
    expect(worktrees.create).not.toHaveBeenCalled()
  })

  it('records launch evidence with the entry file name only', async () => {
    const { agy } = executor()
    await expect(agy.prepare(plan())).resolves.toMatchObject({
      ok: true,
      prepared: {
        evidence: {
          executor: 'agy_cli',
          launch: 'direct',
          source: 'path-search',
          entryFile: 'agy.exe',
          attemptWorkspace: { mode: 'run_workspace' }
        }
      }
    })
  })

  it('keeps the output evidence, never its preview text', () => {
    const report = agyRunReport(
      agyResult({ argv: ['--print=[prompt omitted, 9 chars]', '--sandbox', '--model', 'm'] }),
      'read_only'
    )
    expect(report).toMatchObject({
      verdict: { status: 'completed' },
      lastMessage: { sha256: 'b'.repeat(64), bytes: 64, secretLike: false },
      sandbox: { requested: 'read_only', applied: 'read_only' },
      threadId: null,
      usage: null
    })
    expect(JSON.stringify(report)).not.toContain('PREVIEW-SENTINEL')
  })

  it('reads the applied sandbox from the argv the runner used', () => {
    const noSandbox = agyResult({ argv: ['--print=[prompt omitted, 9 chars]', '--model', 'm'] })
    expect(agyRunReport(noSandbox, 'workspace_write').sandbox).toEqual({
      requested: 'workspace_write',
      applied: 'workspace_write'
    })
    expect(agyRunReport(noSandbox, 'read_only').sandbox).toEqual({
      requested: 'read_only',
      applied: 'workspace_write'
    })
    expect(agyRunReport(agyResult({ applied: null }), 'read_only').sandbox).toEqual({
      requested: 'read_only',
      applied: null
    })
  })
})

describe('agy task executor with the scripted fake agy', () => {
  let fake: FakeAgyRun | null = null
  afterEach(() => {
    fake?.cleanup()
    fake = null
  })

  it('launches with the variant id, the sandbox and no effort flag', async () => {
    const run = createFakeAgyRun(successSteps('alternative draft\n'))
    fake = run
    const agy = createAgyTaskExecutor({
      run: (request, options) => runAgyExec(request, { ...options, deps: run.options().deps }),
      resolveExecutable: () => run.executable,
      workspacePath: () => run.worktree,
      runsRoot: async () => run.runsRoot,
      worktrees: worktreePort(),
      timeoutMs: 60_000
    })
    const ready = await prepared(agy, plan({ dispatchId: 'ctx_fake000002' }))
    const report = await ready.run(new AbortController().signal)
    expect(report.verdict).toEqual({ status: 'completed' })
    expect(report.lastMessage).toMatchObject({ secretLike: false })
    const received = ReceivedSchema.parse(
      JSON.parse(readFileSync(join(run.runsRoot, 'ctx_fake000002', 'fake-received.json'), 'utf8'))
    )
    expect(received.argv).toEqual(
      expect.arrayContaining(['--sandbox', '--model', 'gemini-3.8-flash-high'])
    )
    expect(received.argv.some((token) => token.startsWith('--effort'))).toBe(false)
    expect(received.argv.find((token) => token.startsWith('--print='))).toContain(OBJECTIVE)
    const transcript = readFileSync(
      join(run.runsRoot, 'ctx_fake000002', 'transcript.jsonl'),
      'utf8'
    )
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
    expect(transcript[0]).toMatchObject({ kind: 'start', executor: 'agy', sandbox: 'read-only' })
    expect(transcript).toContainEqual(
      expect.objectContaining({ kind: 'output', stream: 'stdout', text: 'alternative draft' })
    )
    expect(transcript.at(-1)).toMatchObject({ kind: 'end', state: 'completed' })
  }, 30_000)

  it('launches a write attempt in its own worktree without --sandbox and with no extra flag', async () => {
    const run = createFakeAgyRun(successSteps('written\n'))
    fake = run
    const own = { ...WORKTREE, path: run.worktree }
    const agy = createAgyTaskExecutor({
      run: (request, options) => runAgyExec(request, { ...options, deps: run.options().deps }),
      resolveExecutable: () => run.executable,
      workspacePath: () => run.worktree,
      runsRoot: async () => run.runsRoot,
      worktrees: worktreePort(async () => own),
      timeoutMs: 60_000
    })
    const ready = await prepared(
      agy,
      plan({ dispatchId: 'ctx_fake000004', access: 'workspace_write' })
    )
    const report = await ready.run(new AbortController().signal)
    expect(report.sandbox).toEqual({ requested: 'workspace_write', applied: 'workspace_write' })
    const received = ReceivedSchema.parse(
      JSON.parse(readFileSync(join(run.runsRoot, 'ctx_fake000004', 'fake-received.json'), 'utf8'))
    )
    expect(received.argv).not.toContain('--sandbox')
    expect(received.argv.some((token) => /^--(mode(=|$)|dangerously)/.test(token))).toBe(false)
    expect(received.argv.slice(1)).toEqual(['--model', 'gemini-3.8-flash-high'])
    const [start] = readFileSync(join(run.runsRoot, 'ctx_fake000004', 'transcript.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
    expect(start).toMatchObject({
      kind: 'start',
      executor: 'agy',
      sandbox: 'write',
      cwd: run.worktree,
      worktree: { branch: own.branch, path: own.path, baseCommit: own.baseCommit }
    })
  }, 30_000)
})

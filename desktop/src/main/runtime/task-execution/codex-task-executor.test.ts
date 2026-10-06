// FIXTURE_ONLY: a fake runner and a scripted fake codex; no real Codex CLI, model or credential is used.
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CodexExecutableError, type CodexExecutable } from '../../codex-exec/codex-exec-executable'
import {
  createFakeCodexRun,
  successSteps,
  type FakeCodexRun
} from '../../codex-exec/codex-exec-fake-codex.test-fixture'
import type { CodexExecResult } from '../../codex-exec/codex-exec-result'
import type { CodexExecRunOptions } from '../../codex-exec/codex-exec-run-options'
import type { CodexExecRequest } from '../../codex-exec/codex-exec-types'
import { runCodexExec } from '../../codex-exec/codex-exec-run'
import { createCodexExecStreamState } from '../../codex-exec/codex-exec-stream-state'
import { AttemptWorktreeError, type AttemptWorktreePort } from './attempt-worktree'
import { codexRunReport, createCodexTaskExecutor } from './codex-task-executor'
import type { ProcessAttemptPlan } from './process-executor-contract'

const EXECUTABLE: CodexExecutable = {
  program: 'C:/fixture/node/node.exe',
  prefixArgs: ['C:/fixture/npm/codex/bin/codex.js'],
  entryPath: 'C:/fixture/npm/codex/bin/codex.js',
  requestedPath: 'C:/fixture/npm/codex',
  launch: 'node-entry',
  source: 'path-search',
  electronRunAsNode: false
}
const ReceivedSchema = z.object({ argv: z.array(z.string()), stdinBase64: z.string() })
const OBJECTIVE = 'Summarize the repository layout in a short report.'
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
    access: 'workspace_write',
    cli: { model: 'gpt-6.1-sol', effort: 'max' },
    prompt: {
      taskId: 'task_0123456789ab',
      dispatchId: 'ctx_0123456789ab',
      objective: OBJECTIVE,
      expectedOutputs: [],
      acceptanceCriteria: ['Names every folder.'],
      constraints: []
    },
    ...overrides
  }
}

function codexResult(overrides: Partial<CodexExecResult> = {}): CodexExecResult {
  return {
    verdict: { status: 'completed' },
    spawned: true,
    threadId: 'thread-fixture-1',
    threadStartedCount: 1,
    exitCode: 0,
    exitSignal: null,
    usage: { inputTokens: 120, cachedInputTokens: 40, outputTokens: 30, reasoningOutputTokens: 10 },
    applied: {
      model: 'gpt-6.1-sol',
      effort: 'max',
      sandbox: 'read-only',
      ephemeral: false,
      outputSchema: false,
      skipGitRepoCheck: false
    },
    reportedModel: null,
    exactModelVerified: false,
    timing: { startedAt: '2026-10-05T12:00:00.000Z', durationMs: 1500 },
    evidence: null,
    runDir: 'C:/fixture/runs/ctx_0123456789ab',
    lastMessage: {
      state: 'ok',
      path: 'C:/fixture/runs/ctx_0123456789ab/last-message.txt',
      bytes: 42,
      sha256: 'a'.repeat(64),
      secretLike: true
    },
    stream: createCodexExecStreamState().summary(),
    stdoutBytes: 100,
    stdoutDrainTimedOut: false,
    stderrTail: 'token: fixture-not-a-secret',
    stderrTruncated: false,
    listenerErrorCount: 0,
    cancellation: { requested: false },
    treeProof: { verdict: 'unverifiable', method: 'root_exit_only' },
    argv: [],
    envNames: [],
    transcript: null,
    ...overrides
  }
}

function executor(overrides: Partial<Parameters<typeof createCodexTaskExecutor>[0]> = {}) {
  const run = vi.fn(async (_request: CodexExecRequest, _options: CodexExecRunOptions) =>
    codexResult()
  )
  const worktrees = worktreePort()
  const ports = {
    run,
    resolveExecutable: () => EXECUTABLE,
    workspacePath: () => 'C:/fixture/repo',
    runsRoot: async (runId: string) => `C:/fixture/userData/autopilot-runs/${runId}`,
    worktrees,
    timeoutMs: 600_000,
    ...overrides
  }
  return { run, worktrees, codex: createCodexTaskExecutor(ports) }
}

async function prepared(codex: ReturnType<typeof executor>['codex'], input = plan()) {
  const outcome = await codex.prepare(input)
  if (!outcome.ok) {
    throw new Error(`prepare refused: ${outcome.reason}`)
  }
  return outcome.prepared
}

describe('codex task executor', () => {
  it('runs read-only with an explicit effort, the abort signal and the prompt only in the request', async () => {
    const { run, worktrees, codex } = executor()
    const ready = await prepared(codex, plan({ access: 'read_only' }))
    const controller = new AbortController()
    await ready.run(controller.signal)
    expect(run).toHaveBeenCalledTimes(1)
    const [request, options] = run.mock.calls[0] ?? []
    expect(request).toMatchObject({
      model: 'gpt-6.1-sol',
      effort: 'max',
      sandbox: 'read-only',
      worktreePath: 'C:/fixture/repo',
      runsRoot: 'C:/fixture/userData/autopilot-runs/run_0123456789ab',
      runId: 'ctx_0123456789ab'
    })
    expect(request?.prompt).toContain(OBJECTIVE)
    expect(options).toMatchObject({
      executable: EXECUTABLE,
      signal: controller.signal,
      timeoutMs: 600_000
    })
    expect(JSON.stringify(options)).not.toContain(OBJECTIVE)
    expect(worktrees.create).not.toHaveBeenCalled()
  })

  it('runs a write attempt with workspace-write in its own new worktree (D-025)', async () => {
    const { run, worktrees, codex } = executor()
    const ready = await prepared(codex)
    expect(worktrees.create).toHaveBeenCalledTimes(1)
    expect(ready.placement).toEqual({ mode: 'own_worktree', worktree: WORKTREE })
    await ready.run(new AbortController().signal)
    const [request, options] = run.mock.calls[0] ?? []
    expect(request).toMatchObject({
      sandbox: 'workspace-write',
      worktreePath: WORKTREE.path,
      skipGitRepoCheck: false
    })
    expect(request?.prompt).not.toMatch(/read-only/)
    expect(request?.prompt).toMatch(/may change files/)
    expect(options?.transcript).toEqual({
      path: join(
        'C:/fixture/userData/autopilot-runs/run_0123456789ab',
        'ctx_0123456789ab',
        'transcript.jsonl'
      ),
      worktree: { branch: WORKTREE.branch, path: WORKTREE.path, baseCommit: WORKTREE.baseCommit }
    })
  })

  it('refuses the start, with nothing run, when its worktree cannot be created', async () => {
    const { run, codex } = executor({
      worktrees: worktreePort(async () => {
        throw new AttemptWorktreeError('create_failed')
      })
    })
    await expect(codex.prepare(plan())).resolves.toEqual({
      ok: false,
      reason: 'task_worktree_create_failed'
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('creates no worktree before an effort refusal', async () => {
    const { worktrees, codex } = executor()
    await codex.prepare(plan({ cli: { model: 'gpt-6.1-sol', effort: null } }))
    expect(worktrees.create).not.toHaveBeenCalled()
  })

  it('sets no timeout of its own: the run ends when codex ends or the user stops it (D-027)', async () => {
    const { run, codex } = executor({ timeoutMs: undefined })
    const ready = await prepared(codex)
    await ready.run(new AbortController().signal)
    const [, options] = run.mock.calls[0] ?? []
    expect(options).toBeDefined()
    expect(options?.timeoutMs).toBeUndefined()
  })

  it('asks codex to skip its git-repository check only in a folder workspace (D-027)', async () => {
    const { run, codex } = executor()
    await (
      await prepared(codex, plan({ workspaceId: 'folder:fixture-folder' }))
    ).run(new AbortController().signal)
    await (await prepared(codex)).run(new AbortController().signal)
    expect(run.mock.calls.map(([request]) => request.skipGitRepoCheck)).toEqual([true, false])
  })

  it('writes in the folder itself in a folder workspace, with no worktree (D-025)', async () => {
    const { run, worktrees, codex } = executor()
    const ready = await prepared(codex, plan({ workspaceId: 'folder:fixture-folder' }))
    expect(ready.placement).toEqual({ mode: 'folder' })
    await ready.run(new AbortController().signal)
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      sandbox: 'workspace-write',
      worktreePath: 'C:/fixture/repo'
    })
    expect(run.mock.calls[0]?.[1]?.transcript).not.toHaveProperty('worktree')
    expect(worktrees.create).not.toHaveBeenCalled()
  })

  it('writes the attempt transcript beside its other run files', async () => {
    const { run, codex } = executor()
    const ready = await prepared(codex, plan({ access: 'read_only' }))
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

  it('records launch evidence with the entry file name only, never its path', async () => {
    const { codex } = executor()
    const ready = await prepared(codex, plan({ access: 'read_only' }))
    expect(ready.evidence).toEqual({
      executor: 'codex_cli',
      launch: 'node-entry',
      source: 'path-search',
      entryFile: 'codex.js',
      attemptWorkspace: { mode: 'run_workspace' }
    })
  })

  it('records the own worktree of a write attempt in its launch evidence for validation', async () => {
    const { codex } = executor()
    const ready = await prepared(codex)
    expect(ready.evidence).toMatchObject({
      attemptWorkspace: { mode: 'own_worktree', ...WORKTREE }
    })
  })

  it.each(['ultra', 'none', 'minimal'])(
    'prepares effort %s, which the route check admitted from the model listing (D-027)',
    async (effort) => {
      const { codex } = executor()
      await expect(
        codex.prepare(plan({ cli: { model: 'gpt-6.1-sol', effort } }))
      ).resolves.toMatchObject({ ok: true })
    }
  )

  it.each([
    [null, 'effort_missing'],
    ['extreme', 'effort_unsupported'],
    ['MAX', 'effort_unsupported']
  ])('refuses effort %s before anything starts', async (effort, reason) => {
    const { run, codex } = executor()
    await expect(codex.prepare(plan({ cli: { model: 'gpt-6.1-sol', effort } }))).resolves.toEqual({
      ok: false,
      reason
    })
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    [
      'executable_not_found',
      {
        resolveExecutable: () => {
          throw new CodexExecutableError('not_found', 'codex was not found')
        }
      }
    ],
    [
      'workspace_unavailable',
      {
        workspacePath: () => {
          throw new Error('no such workspace')
        }
      }
    ],
    [
      'runs_root_unavailable',
      {
        runsRoot: async () => {
          throw new Error('disk full')
        }
      }
    ]
  ])('refuses with %s when a launch input cannot be resolved', async (reason, overrides) => {
    const { codex } = executor(overrides)
    await expect(codex.prepare(plan())).resolves.toEqual({ ok: false, reason })
  })
})

describe('codexRunReport', () => {
  it('keeps the last-message evidence and the secret-shape flag, never the text or stderr', () => {
    const report = codexRunReport(codexResult(), 'read_only')
    expect(report).toMatchObject({
      verdict: { status: 'completed' },
      exitCode: 0,
      lastMessage: { sha256: 'a'.repeat(64), bytes: 42, secretLike: true },
      sandbox: { requested: 'read_only', applied: 'read_only' },
      threadId: 'thread-fixture-1',
      treeProof: { verdict: 'unverifiable', method: 'root_exit_only' },
      usage: {
        inputTokens: 120,
        cachedInputTokens: 40,
        outputTokens: 30,
        reasoningOutputTokens: 10
      }
    })
    expect(JSON.stringify(report)).not.toContain('fixture-not-a-secret')
    expect(JSON.stringify(report)).not.toContain('last-message.txt')
  })

  it('reports the applied sandbox against the requested access level', () => {
    const applied = {
      model: 'gpt-6.1-sol',
      effort: 'max',
      sandbox: 'workspace-write',
      ephemeral: false,
      outputSchema: false,
      skipGitRepoCheck: false
    } as const
    expect(codexRunReport(codexResult({ applied }), 'workspace_write').sandbox).toEqual({
      requested: 'workspace_write',
      applied: 'workspace_write'
    })
    expect(codexRunReport(codexResult(), 'workspace_write').sandbox).toEqual({
      requested: 'workspace_write',
      applied: 'read_only'
    })
  })

  it('maps failures, blocks and cancellations to the runner-neutral report', () => {
    expect(
      codexRunReport(
        codexResult({
          verdict: {
            status: 'blocked',
            reason: 'quota',
            heuristic: true,
            matchedText: 'usage limit reached',
            failures: [{ kind: 'nonzero_exit', detail: 'exit 1' }]
          },
          lastMessage: {
            state: 'missing',
            path: 'x',
            bytes: null,
            sha256: null,
            secretLike: null
          },
          applied: null,
          cancellation: {
            requested: true,
            trigger: 'abort_signal',
            spawned: true,
            verdict: 'exited',
            method: 'windows_descendant_snapshot',
            rootExited: true,
            escalatedToForce: false
          }
        }),
        'workspace_write'
      )
    ).toMatchObject({
      verdict: { status: 'blocked', reason: 'quota', failureKinds: ['nonzero_exit'] },
      lastMessage: null,
      sandbox: { requested: 'workspace_write', applied: null },
      cancellation: {
        requested: true,
        trigger: 'abort_signal',
        proof: { verdict: 'exited', method: 'windows_descendant_snapshot' }
      }
    })
  })
})

describe('codex task executor with the scripted fake codex', () => {
  let fake: FakeCodexRun | null = null
  afterEach(() => {
    fake?.cleanup()
    fake = null
  })

  it('sends the prompt on stdin only, with the read-only sandbox and the effort on argv', async () => {
    const run = createFakeCodexRun(successSteps('final answer'))
    fake = run
    const codex = createCodexTaskExecutor({
      run: (request, options) => runCodexExec(request, { ...options, deps: run.options().deps }),
      resolveExecutable: () => run.executable,
      workspacePath: () => run.worktree,
      runsRoot: async () => run.runsRoot,
      worktrees: worktreePort(),
      timeoutMs: 60_000
    })
    const ready = await prepared(codex, plan({ dispatchId: 'ctx_fake000001', access: 'read_only' }))
    const report = await ready.run(new AbortController().signal)
    expect(report.verdict).toEqual({ status: 'completed' })
    expect(report.sandbox).toEqual({ requested: 'read_only', applied: 'read_only' })
    const received = ReceivedSchema.parse(
      JSON.parse(readFileSync(join(run.runsRoot, 'ctx_fake000001', 'fake-received.json'), 'utf8'))
    )
    const stdin = Buffer.from(received.stdinBase64, 'base64').toString('utf8')
    expect(stdin).toContain(OBJECTIVE)
    expect(received.argv.join('\n')).not.toContain(OBJECTIVE)
    expect(received.argv).toEqual(expect.arrayContaining(['--sandbox', 'read-only']))
    expect(received.argv).toContain('model_reasoning_effort="max"')
    const transcript = readFileSync(
      join(run.runsRoot, 'ctx_fake000001', 'transcript.jsonl'),
      'utf8'
    )
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
    expect(transcript[0]).toMatchObject({ kind: 'start', executor: 'codex', sandbox: 'read-only' })
    expect(transcript.at(-1)).toMatchObject({ kind: 'end', state: 'completed' })
  }, 30_000)

  it('runs a write attempt with --sandbox workspace-write and --cd in its own worktree', async () => {
    const run = createFakeCodexRun(successSteps('final answer'))
    fake = run
    const own = { ...WORKTREE, path: run.worktree }
    const codex = createCodexTaskExecutor({
      run: (request, options) => runCodexExec(request, { ...options, deps: run.options().deps }),
      resolveExecutable: () => run.executable,
      workspacePath: () => run.worktree,
      runsRoot: async () => run.runsRoot,
      worktrees: worktreePort(async () => own),
      timeoutMs: 60_000
    })
    const ready = await prepared(codex, plan({ dispatchId: 'ctx_fake000003' }))
    const report = await ready.run(new AbortController().signal)
    expect(report.sandbox).toEqual({ requested: 'workspace_write', applied: 'workspace_write' })
    const received = ReceivedSchema.parse(
      JSON.parse(readFileSync(join(run.runsRoot, 'ctx_fake000003', 'fake-received.json'), 'utf8'))
    )
    expect(received.argv).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write']))
    expect(received.argv).not.toContain('danger-full-access')
    expect(received.argv[received.argv.indexOf('--cd') + 1]).toBe(run.worktree)
    const [start] = readFileSync(join(run.runsRoot, 'ctx_fake000003', 'transcript.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
    expect(start).toMatchObject({
      kind: 'start',
      sandbox: 'write',
      cwd: run.worktree,
      worktree: { branch: own.branch, path: own.path, baseCommit: own.baseCommit }
    })
  }, 30_000)
})

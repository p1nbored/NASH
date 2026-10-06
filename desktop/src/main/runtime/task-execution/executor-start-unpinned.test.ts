// FIXTURE_ONLY: C4's executors over the scripted fake codex and fake agy; no real CLI, model or
// credential is resolved or started, and no trust record or pin exists anywhere (D-023).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgyExec } from '../../agy-exec/agy-exec-run'
import {
  createFakeAgyRun,
  successSteps as agySuccessSteps,
  type FakeAgyRun
} from '../../agy-exec/agy-exec-fake-agy.test-fixture'
import { runCodexExec } from '../../codex-exec/codex-exec-run'
import {
  createFakeCodexRun,
  successSteps as codexSuccessSteps,
  type FakeCodexRun
} from '../../codex-exec/codex-exec-fake-codex.test-fixture'
import { createAgyTaskExecutor } from './agy-task-executor'
import { createCodexTaskExecutor } from './codex-task-executor'
import type { ProcessAttemptPlan, ProcessTaskExecutor } from './process-executor-contract'

function plan(dispatchId: string, cli: ProcessAttemptPlan['cli']): ProcessAttemptPlan {
  return {
    dispatchId,
    runId: 'run_0123456789ab',
    taskId: 'task_0123456789ab',
    workspaceId: 'fixture-repo::C:/fixture/repo',
    access: 'read_only',
    cli,
    prompt: {
      taskId: 'task_0123456789ab',
      dispatchId,
      objective: 'Summarize the repository layout.',
      expectedOutputs: [],
      acceptanceCriteria: [],
      constraints: []
    }
  }
}

async function startOnce(executor: ProcessTaskExecutor, input: ProcessAttemptPlan) {
  const outcome = await executor.prepare(input)
  if (!outcome.ok) {
    throw new Error(`prepare refused: ${outcome.reason}`)
  }
  return {
    evidence: outcome.prepared.evidence,
    report: await outcome.prepared.run(new AbortController().signal)
  }
}

describe('Codex and agy start with no trust record and no pin', () => {
  let codexFake: FakeCodexRun | null = null
  let agyFake: FakeAgyRun | null = null

  afterEach(() => {
    codexFake?.cleanup()
    agyFake?.cleanup()
    codexFake = null
    agyFake = null
  })

  it('runs Codex to completion with no expected hash handed to the runner', async () => {
    const fake = createFakeCodexRun(codexSuccessSteps('final answer'))
    codexFake = fake
    const run = vi.fn<typeof runCodexExec>((request, options) =>
      runCodexExec(request, { ...options, deps: fake.options().deps })
    )
    const codex = createCodexTaskExecutor({
      run,
      resolveExecutable: () => fake.executable,
      workspacePath: () => fake.worktree,
      runsRoot: async () => fake.runsRoot,
      worktrees: { create: vi.fn() },
      timeoutMs: 60_000
    })
    const { evidence, report } = await startOnce(
      codex,
      plan('ctx_unpinned0001', { model: 'gpt-6.1-sol', effort: 'max' })
    )
    expect(report).toMatchObject({ verdict: { status: 'completed' }, spawned: true, exitCode: 0 })
    expect(evidence).not.toHaveProperty('pinnedSha256')
    expect(run.mock.calls[0]?.[1]).not.toHaveProperty('expectedExecutableSha256')
  }, 30_000)

  it('runs agy to completion with no expected hash handed to the runner', async () => {
    const fake = createFakeAgyRun(agySuccessSteps('alternative draft\n'))
    agyFake = fake
    const run = vi.fn<typeof runAgyExec>((request, options) =>
      runAgyExec(request, { ...options, deps: fake.options().deps })
    )
    const agy = createAgyTaskExecutor({
      run,
      resolveExecutable: () => fake.executable,
      workspacePath: () => fake.worktree,
      runsRoot: async () => fake.runsRoot,
      worktrees: { create: vi.fn() },
      timeoutMs: 60_000
    })
    const { evidence, report } = await startOnce(
      agy,
      plan('ctx_unpinned0002', { model: 'gemini-3.8-flash-high', effort: null })
    )
    expect(report).toMatchObject({ verdict: { status: 'completed' }, spawned: true, exitCode: 0 })
    expect(evidence).not.toHaveProperty('pinnedSha256')
    expect(run.mock.calls[0]?.[1]).not.toHaveProperty('expectedExecutableSha256')
  }, 30_000)
})

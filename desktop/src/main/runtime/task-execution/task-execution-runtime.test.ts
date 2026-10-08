import { stopWorkflowRunForCancel } from '../workbench-run/workbench-run-stop'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { startLocalWorker } from '../rpc/methods/orchestration/worker/local-worker-start'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getTaskSpecStore } from '../orchestration/db/task-spec-store'
import { readAttemptResult } from './executor-result-view'
import { startRoutedNativeWorker, stopNativeRunWorkers } from './task-start-native'
import {
  CODEX_ROUTE,
  AGY_ROUTE,
  SUBAGENT_ROUTE,
  availableResult,
  seedRoutedAppTask
} from './task-execution.test-fixture'
import type { DelegatedRoute } from './task-start-route'
const nativeStart = vi.hoisted(() => vi.fn())
vi.mock('../rpc/methods/orchestration/worker/local-worker-start', () => ({
  startLocalWorker: nativeStart
}))
// FIXTURE_ONLY: synthetic ports in a temporary data folder; no CLI, model or credential is used.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTaskExecutionRuntime } from './task-execution-runtime'
import {
  FIXTURE_NOW_MS,
  createAppRunHarness,
  type AppRunHarness
} from './task-execution.test-fixture'

describe('task execution runtime', () => {
  it('wires current task starts and native report reads', async () => {
    const harness = createAppRunHarness()
    try {
      const runtime = createTaskExecutionRuntime({
        owner: harness.owner,
        startWorker: vi.fn(),
        routes: { recheck: vi.fn(), latch: vi.fn() },
        now: () => FIXTURE_NOW_MS,
        cliCommand: 'nash',
        log: () => undefined
      })
      expect(typeof runtime.startTask).toBe('function')
      await expect(runtime.readAttemptResult('ctx_unknown00001')).resolves.toEqual({
        state: 'no_result'
      })
    } finally {
      harness.owner.close()
    }
  })
})

describe('routed native worker adapter', () => {
  let harness: AppRunHarness
  let runtime: OrcaRuntimeService
  const creator = {
    kind: 'terminal' as const,
    handle: 'term_primary',
    paneKey: 'tab_primary:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    processIncarnation: 'process-primary'
  }
  beforeEach(() => {
    harness = createAppRunHarness()
    const store = getPrimarySessionStore(harness.owner)
    const primary = store.insertStarting({
      runId: harness.runId,
      launchOperationId: 'launch_native',
      permissionMode: 'manual',
      requestedModel: 'claude-opus-5-5',
      requestedEffort: 'max',
      timestamp: new Date(FIXTURE_NOW_MS).toISOString()
    })
    store.markRunning(primary.ownerId, {
      terminalHandle: creator.handle,
      paneKey: creator.paneKey,
      processIncarnation: creator.processIncarnation,
      launchTokenSha256: null,
      launchLedger: 'orca',
      receipt: {},
      timestamp: new Date(FIXTURE_NOW_MS + 1000).toISOString()
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Only these runtime ports are used; the native launch itself is mocked.
    runtime = {
      getOrchestrationDb: () => harness.owner,
      getTerminalProcessIncarnation: () => creator.processIncarnation,
      getClientSettings: () => ({}),
      getTerminalOrchestrationCliCommand: () => 'nash',
      getRuntimeId: () => 'runtime-native',
      notifyMessageArrived: vi.fn(),
      showManagedWorktree: vi.fn(async () => ({ branch: 'feature/current' }))
    } as unknown as OrcaRuntimeService
    nativeStart.mockReset()
    nativeStart.mockImplementation(async (args: Parameters<typeof startLocalWorker>[0]) => {
      args.assertCanStart?.()
      const started = harness.owner.createStartingWorkerDispatch({
        creator: { kind: 'system' },
        maxDepth: 4,
        taskId: args.existingTask!.id,
        retryOf: args.params.retryOf,
        startOptions: { nativeTask: true, route_id: args.routeId! }
      })
      harness.owner.markWorkerDispatchReady(started.dispatch.id)
      return { dispatchId: started.dispatch.id }
    })
  })
  afterEach(() => harness.owner.close())
  function prepare(fixture = CODEX_ROUTE) {
    const seeded = seedRoutedAppTask(harness, fixture)
    const availability = availableResult(fixture)
    if (availability.status !== 'available') {
      throw new Error('fixture unavailable')
    }
    const route: DelegatedRoute = {
      kind: 'delegated',
      routeId: seeded.routeId,
      target: fixture.target,
      taskType: fixture.taskType,
      subject: fixture.subject,
      availability
    }
    const input = { taskId: seeded.taskId, creator, maxDepth: 4 }
    return { input, route }
  }
  it.each([CODEX_ROUTE, AGY_ROUTE, SUBAGENT_ROUTE])(
    'uses the native launcher and exact $target preferences without executor rows',
    async (fixture) => {
      const { input, route } = prepare(fixture)
      const before = getTaskSpecStore(harness.owner).get(input.taskId)
      const result = await startRoutedNativeWorker(runtime, input, route)
      expect(nativeStart).toHaveBeenCalledWith(
        expect.objectContaining({
          taskAccess: 'read_only',
          routeId: route.routeId,
          params: expect.objectContaining({
            agent:
              fixture.target === 'codex_cli'
                ? 'codex'
                : fixture.target === 'claude_subagent'
                  ? 'claude'
                  : 'antigravity',
            model: fixture.model
          })
        })
      )
      const args = nativeStart.mock.calls[0]![0]
      expect(args.params.effort).toBe(fixture.effort ?? undefined)
      expect(args.taskBrief).toContain('Acceptance criteria:')
      expect(args.taskBrief).toContain('Do not modify any source file.')
      expect(getTaskSpecStore(harness.owner).get(input.taskId)).toEqual(before)
      expect(result.view).toMatchObject({ nativeWorker: true, workerState: 'ready' })
      await result.settled
      expect(harness.owner.getTask(input.taskId)?.status).toBe('dispatched')
    }
  )
  it('accepts the same primary pane leaf after moving it to another tab', async () => {
    const { input, route } = prepare()
    const moved = {
      ...input,
      creator: { ...creator, paneKey: 'tab_moved:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
    }
    await expect(startRoutedNativeWorker(runtime, moved, route)).resolves.toMatchObject({
      view: { nativeWorker: true }
    })
  })
  it('attempts every worker stop when one cannot be confirmed', async () => {
    const first = prepare()
    const second = prepare()
    const a = await startRoutedNativeWorker(runtime, first.input, first.route)
    const b = await startRoutedNativeWorker(runtime, second.input, second.route)
    await expect(stopNativeRunWorkers(runtime, harness.runId)).rejects.toMatchObject({
      code: 'workbench_run_stop_unconfirmed'
    })
    expect(harness.owner.getWorkerDispatch(a.view.dispatchId)?.state).toBe('stop_unknown')
    expect(harness.owner.getWorkerDispatch(b.view.dispatchId)?.state).toBe('stop_unknown')
  })
  it('stops workers even when the primary already failed the run', async () => {
    harness.owner.db
      .prepare(
        "UPDATE workflow_runs SET status = 'failed', end_reason = 'primary_exited', ended_at = '2026-10-08T00:00:00.000Z'"
      )
      .run()
    const stopRunWorkers = vi.fn(async () => undefined)
    const stopPrimarySession = vi.fn()
    const result = await stopWorkflowRunForCancel(
      harness.owner,
      harness.runId,
      'user_canceled',
      () => ({ stopPrimarySession, stopRunWorkers })
    )
    expect(stopRunWorkers).toHaveBeenCalledWith(harness.runId)
    expect(result).toMatchObject({ changed: false, run: { status: 'failed' } })
  })
  it('settles and reads native reports, preserving duplicate report handling', async () => {
    const { input, route } = prepare()
    const result = await startRoutedNativeWorker(runtime, input, route)
    const report = {
      taskId: input.taskId,
      dispatchId: result.view.dispatchId,
      outcome: 'succeeded' as const,
      result: 'Native evidence.'
    }
    expect(harness.owner.settleWorkerReport(report)).toMatchObject({
      action: 'settled',
      duplicate: false
    })
    expect(harness.owner.settleWorkerReport(report)).toMatchObject({
      action: 'settled',
      duplicate: true
    })
    await expect(
      readAttemptResult({ owner: harness.owner }, result.view.dispatchId)
    ).resolves.toMatchObject({ state: 'ok', text: 'Native evidence.' })
  })
  it('keeps the exact receipt if the report arrives during startup', async () => {
    const { input, route } = prepare()
    const start = nativeStart.getMockImplementation()!
    nativeStart.mockImplementation(async (args) => {
      const receipt = await start(args)
      harness.owner.settleWorkerReport({
        taskId: input.taskId,
        dispatchId: receipt.dispatchId,
        outcome: 'succeeded',
        result: 'Already done.'
      })
      return receipt
    })
    expect((await startRoutedNativeWorker(runtime, input, route)).view).toMatchObject({
      taskStatus: 'completed',
      workerState: 'succeeded'
    })
  })
  it('retains an unconfirmed native stop instead of claiming cancellation', async () => {
    const { input, route } = prepare()
    const started = await startRoutedNativeWorker(runtime, input, route)
    await expect(stopNativeRunWorkers(runtime, harness.runId)).rejects.toMatchObject({
      code: 'workbench_run_stop_unconfirmed'
    })
    expect(harness.owner.getWorkerDispatch(started.view.dispatchId)?.state).toBe('stop_unknown')
  })
  it('waits for a pending native start and refuses its dispatch once the primary stops', async () => {
    const { input, route } = prepare()
    let resume!: () => void
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    nativeStart.mockImplementation(async (args) => {
      await gate
      args.assertCanStart()
      throw new Error('must not launch')
    })
    const starting = startRoutedNativeWorker(runtime, input, route)
    const rejection = expect(starting).rejects.toMatchObject({ code: 'autopilot_run_not_live' })
    harness.owner.db
      .prepare(
        "UPDATE primary_sessions SET state = 'stopped', ended_at = '2026-10-08T00:00:00.000Z', end_reason = 'user_canceled'"
      )
      .run()
    let stopped = false
    const stopping = stopNativeRunWorkers(runtime, harness.runId).then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    resume()
    await rejection
    await stopping
    expect(harness.owner.getDispatchContext(input.taskId)).toBeUndefined()
  })
})

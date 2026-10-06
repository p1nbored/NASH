// FIXTURE_ONLY: synthetic runs, attempts and a fake stop port; no real process is started or stopped.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../../../orca-runtime'
import { getAppAttemptSettlement } from '../../../../orchestration/db/app-attempt-settlement'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../../../../orchestration/db/app-attempt.test-fixture'
import { seedRoutedTask } from '../../../../orchestration/db/app-attempt-routing.test-fixture'
import { fixtureTime } from '../../../../orchestration/db/autopilot-runtime.test-fixture'
import { getExecutorProcessStore } from '../../../../orchestration/db/executor-process-store'
import {
  registerExecutorStopPort,
  type ExecutorStopOutcome,
  type ExecutorStopPort
} from '../../../../workflow-run/executor-stop-port'
import { ORCHESTRATION_METHODS } from '../../orchestration'
import { eraseRpcMethods } from '../../../core'

const NO_TERMINAL_REASON = 'The Dispatch has no recorded agent terminal.'

describe('orchestration.workerStop for app executor attempts', () => {
  let harness: AppRunHarness
  let runtime: OrcaRuntimeService
  let closeTerminal: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    harness = createAppRunHarness()
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(harness.owner)
    vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => undefined)
    closeTerminal = vi.spyOn(runtime, 'closeTerminal')
  })
  afterEach(() => harness.owner.close())

  async function stop(dispatch: string) {
    const method = eraseRpcMethods(ORCHESTRATION_METHODS).find(
      (candidate) => candidate.name === 'orchestration.workerStop'
    )
    if (!method) {
      throw new Error('workerStop is not registered')
    }
    return method.handler(method.params!.parse({ dispatch }), { runtime }) as Promise<{
      dispatchId: string
      state: string
      alreadySettled: boolean
      processAction: string
      lastError?: string | null
    }>
  }

  /** A Codex or agy attempt as task-start leaves it: no terminal, worker ready, executor running. */
  function appExecutorAttempt(kind: 'codex_cli' | 'agy_cli' = 'codex_cli'): string {
    const seeded = seedRoutedTask(harness, {
      route: kind === 'agy_cli' ? { target: 'agy_cli', model: 'gemini-3.8-flash-high' } : {}
    })
    const settlement = getAppAttemptSettlement(harness.owner)
    const view = settlement.start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: kind,
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    settlement.markRunning({
      dispatchId: view.dispatchId,
      executableEvidence: { executable: kind === 'agy_cli' ? 'agy' : 'codex' },
      timestamp: fixtureTime(6)
    })
    return view.dispatchId
  }

  /** A ready worker with no terminal and no executor row, as an in-session or legacy dispatch has. */
  function readyWorkerWithoutExecutor(): string {
    const seeded = seedRoutedTask(harness)
    const started = harness.owner.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      taskId: seeded.taskId,
      startOptions: {},
      runtimeEpoch: runtime.getRuntimeId()
    })
    harness.owner.markWorkerDispatchReady(started.dispatch.id)
    return started.dispatch.id
  }

  function fakePort(outcome: ExecutorStopOutcome) {
    const port = { stopExecutor: vi.fn(async () => outcome) } satisfies ExecutorStopPort
    registerExecutorStopPort(runtime, port)
    return port
  }

  it('sends a Codex attempt to the executor port and settles it through B3 on a proven exit', async () => {
    const dispatchId = appExecutorAttempt('codex_cli')
    const port = fakePort({ verdict: 'exited', method: 'windows_descendant_snapshot' })

    const receipt = await stop(dispatchId)

    expect(port.stopExecutor).toHaveBeenCalledWith({ dispatchId, kind: 'codex_cli' })
    expect(receipt).toEqual({
      dispatchId,
      state: 'stopped',
      alreadySettled: false,
      processAction: 'stopped_executor'
    })
    expect(harness.owner.getWorkerDispatch(dispatchId)?.state).toBe('stopped')
    expect(getExecutorProcessStore(harness.owner).get(dispatchId)).toMatchObject({
      state: 'stopped',
      stopVerdict: 'exited'
    })
    expect(closeTerminal).not.toHaveBeenCalled()
  })

  it('sends an agy attempt to the same port with its own kind', async () => {
    const dispatchId = appExecutorAttempt('agy_cli')
    const port = fakePort({ verdict: 'exited', method: 'root_exit_only' })

    await stop(dispatchId)

    expect(port.stopExecutor).toHaveBeenCalledWith({ dispatchId, kind: 'agy_cli' })
  })

  it('reports stop_unknown, never the no-terminal reason, when the tree is not proven gone', async () => {
    const dispatchId = appExecutorAttempt()
    fakePort({ verdict: 'unverifiable', method: 'root_exit_only' })

    const receipt = await stop(dispatchId)

    expect(receipt.state).toBe('stop_unknown')
    expect(receipt.lastError).toBe('executor_tree_unverifiable')
    expect(getExecutorProcessStore(harness.owner).get(dispatchId)?.state).toBe('stop_unknown')
  })

  it('reports stop_unknown with nothing closed when no stop port is registered', async () => {
    const dispatchId = appExecutorAttempt()

    const receipt = await stop(dispatchId)

    expect(receipt).toMatchObject({
      state: 'stop_unknown',
      processAction: 'none',
      lastError: 'executor_stop_unavailable'
    })
    expect(closeTerminal).not.toHaveBeenCalled()
  })

  it('answers a repeated stop from the settled worker without asking the port again', async () => {
    const dispatchId = appExecutorAttempt()
    const port = fakePort({ verdict: 'exited', method: 'root_exit_only' })

    await stop(dispatchId)
    const second = await stop(dispatchId)

    expect(second).toMatchObject({ state: 'stopped', alreadySettled: true, processAction: 'none' })
    expect(port.stopExecutor).toHaveBeenCalledTimes(1)
  })

  describe('a dispatch that is not an app executor attempt', () => {
    it('keeps the no-recorded-terminal path when it has no executor row', async () => {
      const port = fakePort({ verdict: 'exited', method: 'root_exit_only' })
      const dispatchId = readyWorkerWithoutExecutor()

      const receipt = await stop(dispatchId)

      expect(receipt).toMatchObject({
        state: 'stop_unknown',
        processAction: 'unknown',
        lastError: NO_TERMINAL_REASON
      })
      expect(port.stopExecutor).not.toHaveBeenCalled()
    })

    it('keeps Orca dispatch_not_found for an unknown dispatch', async () => {
      await expect(stop('ctx_missing')).rejects.toMatchObject({ code: 'dispatch_not_found' })
    })
  })
})

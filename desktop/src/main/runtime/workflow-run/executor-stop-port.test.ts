// FIXTURE_ONLY: synthetic runs, attempts and a fake stop port; no real process is started or stopped.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getExecutorProcessStore } from '../orchestration/db/executor-process-store'
import {
  registerExecutorStopPort,
  stopAppExecutorAttempt,
  type ExecutorStopOutcome,
  type ExecutorStopPort
} from './executor-stop-port'

describe('executor stop port', () => {
  let harness: AppRunHarness
  let runtime: OrcaRuntimeService
  let notify: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    harness = createAppRunHarness()
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(harness.owner)
    notify = vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => undefined)
  })
  afterEach(() => harness.owner.close())

  const settlement = () => getAppAttemptSettlement(harness.owner)
  const executorState = (dispatchId: string) =>
    getExecutorProcessStore(harness.owner).get(dispatchId)

  /** A Codex attempt as task-start leaves it once the process is up: worker ready, executor running. */
  function runningAttempt(kind: 'codex_cli' | 'agy_cli' = 'codex_cli'): {
    dispatchId: string
    taskId: string
  } {
    const seeded = seedRoutedTask(harness, {
      route: kind === 'agy_cli' ? { target: 'agy_cli', model: 'gemini-3.8-flash-high' } : {}
    })
    const view = settlement().start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: kind,
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    settlement().markRunning({
      dispatchId: view.dispatchId,
      executableEvidence: { executable: kind === 'agy_cli' ? 'agy' : 'codex' },
      timestamp: fixtureTime(6)
    })
    return { dispatchId: view.dispatchId, taskId: seeded.taskId }
  }

  function fakePort(outcome: ExecutorStopOutcome | Error): ExecutorStopPort & {
    stopExecutor: ReturnType<typeof vi.fn>
  } {
    return {
      stopExecutor: vi.fn(async () => {
        if (outcome instanceof Error) {
          throw outcome
        }
        return outcome
      })
    }
  }

  it('returns null for a dispatch that is not an executor attempt, without touching the port', async () => {
    const seeded = seedRoutedTask(harness)
    const plain = harness.owner.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      taskId: seeded.taskId,
      startOptions: {},
      runtimeEpoch: runtime.getRuntimeId()
    })
    const port = fakePort({ verdict: 'exited', method: 'root_exit_only' })
    registerExecutorStopPort(runtime, port)

    await expect(stopAppExecutorAttempt(runtime, plain.dispatch.id)).resolves.toBeNull()

    expect(port.stopExecutor).not.toHaveBeenCalled()
    expect(harness.owner.getWorkerDispatch(plain.dispatch.id)?.state).toBe('starting')
  })

  it('returns null for a dispatch Orca no longer holds, so Orca answers dispatch_not_found', async () => {
    await expect(stopAppExecutorAttempt(runtime, 'ctx_gone')).resolves.toBeNull()
  })

  it('settles through B3 as stopped only when the port proves the tree exited', async () => {
    const { dispatchId, taskId } = runningAttempt('agy_cli')
    const port = fakePort({ verdict: 'exited', method: 'windows_descendant_snapshot' })
    registerExecutorStopPort(runtime, port)

    const receipt = await stopAppExecutorAttempt(runtime, dispatchId)

    expect(port.stopExecutor).toHaveBeenCalledWith({ dispatchId, kind: 'agy_cli' })
    expect(receipt).toEqual({
      dispatchId,
      state: 'stopped',
      alreadySettled: false,
      processAction: 'stopped_executor'
    })
    expect(harness.owner.getWorkerDispatch(dispatchId)?.state).toBe('stopped')
    expect(harness.owner.getDispatchContextById(dispatchId)?.status).toBe('failed')
    expect(harness.owner.getTask(taskId)?.status).toBe('blocked')
    expect(executorState(dispatchId)).toMatchObject({
      state: 'stopped',
      stopVerdict: 'exited',
      treeVerdict: 'exited',
      treeMethod: 'windows_descendant_snapshot'
    })
    expect(notify).toHaveBeenCalledWith(`dispatch:${dispatchId}`, 'status')
  })

  it.each(['live', 'unverifiable'] as const)(
    'records stop_unknown on both rows when the tree verdict is %s',
    async (verdict) => {
      const { dispatchId } = runningAttempt()
      registerExecutorStopPort(runtime, fakePort({ verdict, method: 'root_exit_only' }))

      const receipt = await stopAppExecutorAttempt(runtime, dispatchId)

      expect(receipt).toEqual({
        dispatchId,
        state: 'stop_unknown',
        alreadySettled: false,
        processAction: 'unknown',
        lastError: `executor_tree_${verdict}`
      })
      expect(harness.owner.getWorkerDispatch(dispatchId)?.state).toBe('stop_unknown')
      expect(executorState(dispatchId)).toMatchObject({
        state: 'stop_unknown',
        stopVerdict: verdict,
        treeMethod: 'root_exit_only'
      })
    }
  )

  it('records stop_unknown without copying the port error text, which may hold a secret', async () => {
    const { dispatchId } = runningAttempt()
    registerExecutorStopPort(
      runtime,
      fakePort(new Error('spawn failed token=sk-fixture-0123456789abcdef0123456789abcdef'))
    )

    const receipt = await stopAppExecutorAttempt(runtime, dispatchId)

    expect(receipt).toMatchObject({
      state: 'stop_unknown',
      processAction: 'unknown',
      lastError: 'executor_stop_failed'
    })
    expect(JSON.stringify(receipt)).not.toContain('sk-fixture')
    expect(JSON.stringify(executorState(dispatchId))).not.toContain('sk-fixture')
    expect(harness.owner.getWorkerDispatch(dispatchId)?.last_error).toBe('executor_stop_failed')
  })

  it('records stop_unknown, closing nothing, when no stop port is registered', async () => {
    const { dispatchId } = runningAttempt()

    const receipt = await stopAppExecutorAttempt(runtime, dispatchId)

    expect(receipt).toEqual({
      dispatchId,
      state: 'stop_unknown',
      alreadySettled: false,
      processAction: 'none',
      lastError: 'executor_stop_unavailable'
    })
    expect(executorState(dispatchId)).toMatchObject({
      state: 'stop_unknown',
      stopVerdict: 'unverifiable'
    })
  })

  it('lets a later stop prove the exit that an earlier one could not', async () => {
    const { dispatchId } = runningAttempt()
    await stopAppExecutorAttempt(runtime, dispatchId)
    registerExecutorStopPort(runtime, fakePort({ verdict: 'exited', method: 'root_exit_only' }))

    const receipt = await stopAppExecutorAttempt(runtime, dispatchId)

    expect(receipt).toMatchObject({ state: 'stopped', processAction: 'stopped_executor' })
    expect(executorState(dispatchId)).toMatchObject({ state: 'stopped', stopVerdict: 'exited' })
  })

  it('answers a worker that is already settled without asking the port', async () => {
    const { dispatchId } = runningAttempt()
    const port = fakePort({ verdict: 'exited', method: 'root_exit_only' })
    registerExecutorStopPort(runtime, port)
    await stopAppExecutorAttempt(runtime, dispatchId)

    const second = await stopAppExecutorAttempt(runtime, dispatchId)

    expect(second).toEqual({
      dispatchId,
      state: 'stopped',
      alreadySettled: true,
      processAction: 'none'
    })
    expect(port.stopExecutor).toHaveBeenCalledTimes(1)
  })

  it('accepts a stop that another settlement completed while this one was in flight', async () => {
    const { dispatchId } = runningAttempt()
    const port: ExecutorStopPort = {
      stopExecutor: vi.fn(async () => {
        settlement().settleStop({
          dispatchId,
          stopVerdict: 'exited',
          reason: 'stopped_on_request',
          timestamp: fixtureTime(7)
        })
        return { verdict: 'exited', method: 'root_exit_only' } satisfies ExecutorStopOutcome
      })
    }
    registerExecutorStopPort(runtime, port)

    const receipt = await stopAppExecutorAttempt(runtime, dispatchId)

    expect(receipt).toMatchObject({ state: 'stopped', alreadySettled: false })
    expect(harness.owner.getWorkerDispatch(dispatchId)?.state).toBe('stopped')
  })

  it('lets B3 refuse a stop that lost the race to the executor claim, changing nothing', async () => {
    const { dispatchId, taskId } = runningAttempt()
    const port: ExecutorStopPort = {
      stopExecutor: vi.fn(async () => {
        settlement().settleClaim({
          dispatchId,
          exitCode: 0,
          tree: { verdict: 'exited', method: 'root_exit_only' },
          lastMessage: { sha256: 'f'.repeat(64), bytes: 1, secretLike: false },
          timestamp: fixtureTime(7)
        })
        return { verdict: 'exited', method: 'root_exit_only' } satisfies ExecutorStopOutcome
      })
    }
    registerExecutorStopPort(runtime, port)

    await expect(stopAppExecutorAttempt(runtime, dispatchId)).rejects.toMatchObject({
      code: 'autopilot_attempt_conflict'
    })

    expect(harness.owner.getWorkerDispatch(dispatchId)?.state).toBe('ready')
    expect(harness.owner.getTask(taskId)?.status).toBe('blocked')
  })

  it('refuses to stop an attempt whose start outcome is unknown, without asking the port', async () => {
    const seeded = seedRoutedTask(harness)
    const view = settlement().start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'codex_cli',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    settlement().markStartUnknown({
      dispatchId: view.dispatchId,
      reason: 'restart',
      timestamp: fixtureTime(6)
    })
    const port = fakePort({ verdict: 'exited', method: 'root_exit_only' })
    registerExecutorStopPort(runtime, port)

    await expect(stopAppExecutorAttempt(runtime, view.dispatchId)).rejects.toMatchObject({
      code: 'autopilot_policy_stop_unavailable',
      data: { effectsApplied: false }
    })

    expect(port.stopExecutor).not.toHaveBeenCalled()
    expect(harness.owner.getWorkerDispatch(view.dispatchId)?.state).toBe('start_unknown')
  })

  describe('registration', () => {
    const exited = { verdict: 'exited', method: 'root_exit_only' } as const

    it('refuses a second port for one runtime and lets a new one in after unregister', () => {
      const first = registerExecutorStopPort(runtime, fakePort(exited))

      expect(() => registerExecutorStopPort(runtime, fakePort(exited))).toThrow(
        /already registered/
      )
      first()
      expect(() => registerExecutorStopPort(runtime, fakePort(exited))).not.toThrow()
    })

    it('keeps ports of different runtimes apart', async () => {
      const { dispatchId } = runningAttempt()
      const other = new OrcaRuntimeService()
      const otherPort = fakePort(exited)
      registerExecutorStopPort(other, otherPort)

      const receipt = await stopAppExecutorAttempt(runtime, dispatchId)

      expect(otherPort.stopExecutor).not.toHaveBeenCalled()
      expect(receipt).toMatchObject({ state: 'stop_unknown', processAction: 'none' })
    })

    it('an unregister of a replaced port leaves the current one in place', () => {
      const first = registerExecutorStopPort(runtime, fakePort(exited))
      first()
      registerExecutorStopPort(runtime, fakePort(exited))

      first()

      expect(() => registerExecutorStopPort(runtime, fakePort(exited))).toThrow(
        /already registered/
      )
    })
  })
})

describe('executor stop port on a database without the app tables', () => {
  it('returns null for every dispatch', async () => {
    const { OrchestrationDb } = await import('../orchestration/db')
    const db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    const port = { stopExecutor: vi.fn() }
    registerExecutorStopPort(runtime, port)

    await expect(stopAppExecutorAttempt(runtime, 'ctx_unknown')).resolves.toBeNull()

    expect(port.stopExecutor).not.toHaveBeenCalled()
    db.close()
  })
})

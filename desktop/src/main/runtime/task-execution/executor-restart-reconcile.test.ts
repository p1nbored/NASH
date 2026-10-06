// FIXTURE_ONLY: synthetic attempts left behind by an earlier app process; nothing is started or stopped.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isEnglishText } from '../../../shared/english-text'
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import { startOrcaDispatch } from '../orchestration/db/app-attempt-routing.test-fixture'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getExecutorProcessStore } from '../orchestration/db/executor-process-store'
import { createExecutorRegistry, type ExecutorRegistry } from './executor-registry'
import { reconcileExecutorsAfterRestart } from './executor-restart-reconcile'
import {
  CODEX_ROUTE,
  FIXTURE_NOW_MS,
  announceSpy,
  createAppRunHarness,
  seedRoutedAppTask,
  type AnnounceSpy,
  type AppRunHarness
} from './task-execution.test-fixture'

describe('reconcileExecutorsAfterRestart', () => {
  let harness: AppRunHarness
  let spy: AnnounceSpy
  let registry: ExecutorRegistry

  beforeEach(() => {
    harness = createAppRunHarness()
    spy = announceSpy()
    registry = createExecutorRegistry({ recordedTree: () => null })
  })
  afterEach(() => harness.owner.close())

  function startedAttempt(): { taskId: string; dispatchId: string } {
    const { taskId, routeId } = seedRoutedAppTask(harness, CODEX_ROUTE)
    const view = getAppAttemptSettlement(harness.owner).start({
      taskId,
      routeId,
      executor: 'codex_cli',
      creator: { kind: 'system' },
      maxDepth: 4,
      timestamp: fixtureTime(10)
    })
    return { taskId, dispatchId: view.dispatchId }
  }

  function runningAttempt(): { taskId: string; dispatchId: string } {
    const attempt = startedAttempt()
    getAppAttemptSettlement(harness.owner).markRunning({
      dispatchId: attempt.dispatchId,
      executableEvidence: { executor: 'codex_cli', entryFile: 'fixture-cli' },
      timestamp: fixtureTime(11)
    })
    return attempt
  }

  function reconcile() {
    return reconcileExecutorsAfterRestart({
      owner: harness.owner,
      registry,
      now: () => FIXTURE_NOW_MS,
      cliCommand: 'orca',
      announce: spy.announce,
      log: () => undefined
    })
  }

  it('marks a start left starting as start_unknown and retries nothing', () => {
    const { taskId, dispatchId } = startedAttempt()
    const summary = reconcile()
    expect(summary.startUnknown).toEqual([dispatchId])
    expect(getExecutorProcessStore(harness.owner).get(dispatchId)?.state).toBe('start_unknown')
    expect(harness.owner.getWorkerDispatch(dispatchId)?.state).toBe('start_unknown')
    expect(harness.owner.getTask(taskId)?.status).toBe('blocked')
    expect(harness.owner.getDispatchContext(taskId)?.id).toBe(dispatchId)
  })

  it('marks a run left running as stop_unknown, since its tree cannot be observed any more', () => {
    const { dispatchId } = runningAttempt()
    const summary = reconcile()
    expect(summary.stopUnknown).toEqual([dispatchId])
    expect(getExecutorProcessStore(harness.owner).get(dispatchId)).toMatchObject({
      state: 'stop_unknown',
      stopVerdict: 'unverifiable',
      verdict: { reason: 'app_restarted' }
    })
  })

  it('fails a start whose executor row was never written, because no process can exist', () => {
    const { taskId, routeId } = seedRoutedAppTask(harness, CODEX_ROUTE)
    const { dispatchId } = startOrcaDispatch(harness, taskId, routeId)
    const summary = reconcile()
    expect(summary.startFailed).toEqual([dispatchId])
    expect(harness.owner.getTask(taskId)?.status).toBe('failed')
  })

  it('leaves alone an attempt this app process still runs', () => {
    const { dispatchId } = runningAttempt()
    registry.track(dispatchId, 'codex_cli')
    const summary = reconcile()
    expect(summary.skipped).toEqual([dispatchId])
    expect(getExecutorProcessStore(harness.owner).get(dispatchId)?.state).toBe('running')
  })

  it('files one English notice per reconciled attempt and announces it', () => {
    startedAttempt()
    runningAttempt()
    reconcile()
    expect(spy.messages).toHaveLength(2)
    for (const message of spy.messages) {
      expect(isEnglishText(`${message.subject}\n${message.body}`)).toBe(true)
      expect(message.body).toMatch(/nothing is retried/i)
    }
  })

  it('does nothing on a clean start', () => {
    expect(reconcile()).toEqual({
      startUnknown: [],
      stopUnknown: [],
      startFailed: [],
      skipped: [],
      failed: []
    })
  })
})

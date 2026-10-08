// FIXTURE_ONLY: synthetic runs, routes and fake executors; no CLI, model, network or credential is used.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { isEnglishText } from '../../../shared/english-text'
import type {
  RouteAvailabilityResult,
  RouteSubject
} from '../../routing-table/availability/route-availability-types'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getTaskRouteStore } from '../orchestration/db/task-route-store'
import {
  createTaskStartService,
  type TaskStartService,
  type TaskStartDeps
} from './task-start-service'
import type { RouteRecheckPort } from './task-start-route'
import {
  AGY_ROUTE,
  CODEX_ROUTE,
  FIXTURE_NOW_MS,
  PRIMARY_ROUTE,
  SUBAGENT_ROUTE,
  WORKFLOW_ROUTE,
  availableResult,
  createAppRunHarness,
  seedKeptAppTask,
  seedRoutedAppTask,
  unavailableResult,
  type AppRunHarness,
  type RouteFixture
} from './task-execution.test-fixture'

describe('task start service', () => {
  let harness: AppRunHarness
  let recheck: Mock<RouteRecheckPort['recheck']>
  let latch: Mock<RouteRecheckPort['latch']>
  let startWorker: Mock<TaskStartDeps['startWorker']>
  let service: TaskStartService
  let clock: number

  function recheckAnswers(result: (subject: RouteSubject) => RouteAvailabilityResult): void {
    recheck.mockImplementation(async (subject: RouteSubject) => result(subject))
  }

  beforeEach(() => {
    harness = createAppRunHarness()
    clock = FIXTURE_NOW_MS
    recheck = vi.fn<RouteRecheckPort['recheck']>()
    latch = vi.fn<RouteRecheckPort['latch']>()
    startWorker = vi.fn()
    service = createTaskStartService({
      owner: harness.owner,
      routes: { recheck, latch },
      startWorker,
      now: () => (clock += 1000),
      cliCommand: 'orca',
      log: () => undefined
    })
  })
  afterEach(() => harness.owner.close())

  function start(taskId: string) {
    return service.startTask({ taskId, creator: { kind: 'system' }, maxDepth: 4 })
  }

  async function startRouted(route: RouteFixture, spec?: Parameters<typeof seedRoutedAppTask>[2]) {
    const seeded = seedRoutedAppTask(harness, route, spec)
    recheckAnswers(() => availableResult(route))
    return { seeded, started: await start(seeded.taskId) }
  }

  function codeOf(error: unknown): string | null {
    return error instanceof OrchestrationError ? error.code : null
  }

  describe('route re-check', () => {
    it('refuses a start on a route the re-check finds unavailable, and records that answer', async () => {
      const { taskId } = seedRoutedAppTask(harness, CODEX_ROUTE)
      recheckAnswers(() => unavailableResult(CODEX_ROUTE, ['quota_exhausted']))
      const error = await start(taskId).catch((caught: unknown) => caught)
      expect(codeOf(error)).toBe('autopilot_route_not_available')
      expect(recheck).toHaveBeenCalledWith(CODEX_ROUTE.subject, {
        workspace: { workspaceId: 'fixture-repo::/fixture/repo' },
        liveRunPrimary: null
      })
      expect(harness.owner.getDispatchContext(taskId)).toBeUndefined()
      expect(harness.owner.getTask(taskId)?.status).toBe('ready')
      expect(getTaskRouteStore(harness.owner).latestForTask(taskId)).toMatchObject({
        status: 'unavailable',
        reasons: ['quota_exhausted'],
        target: 'codex_cli'
      })
      expect(startWorker).not.toHaveBeenCalled()
    })

    it('refuses Codex in a folder workspace as the re-check reports it, and never works around it', async () => {
      const { taskId } = seedRoutedAppTask(harness, CODEX_ROUTE)
      harness.owner.db
        .prepare('UPDATE workflow_runs SET workspace_id = ? WHERE run_id = ?')
        .run('folder:fixture-folder', harness.runId)
      recheckAnswers(() => unavailableResult(CODEX_ROUTE, ['workspace_not_git']))
      const error = await start(taskId).catch((caught: unknown) => caught)
      expect(codeOf(error)).toBe('autopilot_route_not_available')
      expect(recheck).toHaveBeenCalledWith(CODEX_ROUTE.subject, {
        workspace: { workspaceId: 'folder:fixture-folder' },
        liveRunPrimary: null
      })
      expect(startWorker).not.toHaveBeenCalled()
    })

    it('refuses a Codex route row that names no model, before any re-check', async () => {
      // The store refuses an available Codex row without a model, so the row is an unverified one.
      const seeded = seedRoutedAppTask(harness, CODEX_ROUTE)
      getTaskRouteStore(harness.owner).record({
        classificationId: seeded.classificationId,
        routingTableVersion: 1,
        routingTableSha256: 'c'.repeat(64),
        target: 'codex_cli',
        model: null,
        policyLevel: 'max',
        cliSetting: null,
        status: 'unverified',
        reasons: ['model_list_unavailable'],
        availability: { subject: CODEX_ROUTE.subject },
        timestamp: fixtureTime(4)
      })
      const error = await start(seeded.taskId).catch((caught: unknown) => caught)
      expect(codeOf(error)).toBe('autopilot_route_model_missing')
      expect(recheck).not.toHaveBeenCalled()
    })

    it('refuses a route whose stored answer carries no subject to re-check', async () => {
      const { taskId } = seedRoutedAppTask(harness, CODEX_ROUTE, {
        availability: { cli: 'present' }
      })
      const error = await start(taskId).catch((caught: unknown) => caught)
      expect(codeOf(error)).toBe('autopilot_route_subject_missing')
      expect(recheck).not.toHaveBeenCalled()
    })

    it('refuses a route whose stored subject names another target', async () => {
      const { taskId } = seedRoutedAppTask(harness, CODEX_ROUTE, {
        availability: { subject: AGY_ROUTE.subject }
      })
      const error = await start(taskId).catch((caught: unknown) => caught)
      expect(codeOf(error)).toBe('autopilot_route_subject_mismatch')
    })

    it('refuses a start outside an active run', async () => {
      const { taskId } = seedRoutedAppTask(harness, CODEX_ROUTE)
      harness.owner.db.prepare("UPDATE workflow_runs SET status = 'completing'").run()
      const error = await start(taskId).catch((caught: unknown) => caught)
      expect(codeOf(error)).toBe('autopilot_run_not_live')
      expect(recheck).not.toHaveBeenCalled()
    })
  })

  it.each([CODEX_ROUTE, AGY_ROUTE, SUBAGENT_ROUTE])(
    'hands a rechecked $target route to the native worker without opening a duplicate dispatch',
    async (route) => {
      if (route.target === 'claude_subagent') {
        harness.owner.db.exec("UPDATE workflow_runs SET coordinator_agent = 'codex'")
      }
      const seeded = seedRoutedAppTask(harness, route)
      recheckAnswers(() => availableResult(route))
      startWorker.mockImplementation(async (input, checked) => {
        expect(harness.owner.getDispatchContext(input.taskId)).toBeUndefined()
        expect(checked.availability.cli).toMatchObject({ model: route.model, effort: route.effort })
        return {
          view: {
            taskId: input.taskId,
            dispatchId: 'ctx_native',
            routeId: checked.routeId,
            target: checked.target,
            delegated: true,
            runsIn: 'process',
            nativeWorker: true,
            taskStatus: 'dispatched',
            workerState: 'ready',
            instruction: 'Wait for the native worker report.'
          },
          settled: Promise.resolve()
        }
      })
      const result = await start(seeded.taskId)
      expect(result.view.nativeWorker).toBe(true)
      expect(startWorker).toHaveBeenCalledTimes(1)
      expect(result.view.routeId).not.toBe(seeded.routeId)
    }
  )

  describe('in-session attempts', () => {
    it('declares a ready worker and returns the subagent instruction without starting a process', async () => {
      const { seeded, started } = await startRouted(SUBAGENT_ROUTE)
      expect(started.view).toMatchObject({ target: 'claude_subagent', runsIn: 'session' })
      expect(started.view.instruction).toContain('`autopilot-software_engineering`')
      expect(started.view.instruction).toContain(`Attempt: ${started.view.dispatchId}`)
      expect(started.view.instruction).toContain(
        `orca orchestration task-report --task ${seeded.taskId} --attempt ${started.view.dispatchId} --summary-file - --json`
      )
      expect(harness.owner.getWorkerDispatch(started.view.dispatchId)).toMatchObject({
        state: 'ready',
        stage: 'executor_running'
      })
      expect(harness.owner.getDispatchContextById(started.view.dispatchId)?.status).toBe(
        'dispatched'
      )
      expect(startWorker).not.toHaveBeenCalled()
      await started.settled
    })

    it('starts a task the primary keeps as its own attempt, with no re-check and no process', async () => {
      const kept = seedKeptAppTask(harness)
      const { view, settled } = await start(kept.taskId)
      await settled
      expect(view).toMatchObject({
        taskId: kept.taskId,
        routeId: kept.routeId,
        target: 'claude_primary',
        delegated: false,
        runsIn: 'session',
        workerState: 'ready'
      })
      expect(isEnglishText(view.instruction)).toBe(true)
      expect(view.instruction).toMatch(/yourself/)
      expect(view.instruction).toContain(
        `orca orchestration task-report --task ${kept.taskId} --attempt ${view.dispatchId} --summary-file - --json`
      )
      expect(recheck).not.toHaveBeenCalled()
      expect(getTaskRouteStore(harness.owner).latestForTask(kept.taskId)?.routeId).toBe(
        kept.routeId
      )
      expect(startWorker).not.toHaveBeenCalled()
    })

    it('keeps an inheriting workflow route without a model of its own', async () => {
      const { seeded, started } = await startRouted(WORKFLOW_ROUTE, {
        spec: { workflowName: 'release-notes' }
      })
      expect(started.view.delegated).toBe(true)
      expect(getTaskRouteStore(harness.owner).latestForTask(seeded.taskId)).toMatchObject({
        routeId: started.view.routeId,
        model: null,
        policyLevel: 'inherit'
      })
      expect(started.view.instruction).not.toMatch(/claude-opus/)
    })

    it('passes evidence of the live primary to the re-check of an in-session route', async () => {
      const sessions = getPrimarySessionStore(harness.owner)
      const session = sessions.insertStarting({
        runId: harness.runId,
        launchOperationId: 'launch_fixture_1',
        permissionMode: 'manual',
        requestedModel: 'claude-opus-5-5',
        requestedEffort: 'max',
        timestamp: fixtureTime(1)
      })
      sessions.markRunning(session.ownerId, {
        terminalHandle: 'term_fixture',
        paneKey: 'pane:fixture',
        processIncarnation: 'incarnation-1',
        launchTokenSha256: null,
        launchLedger: 'orca',
        receipt: {},
        timestamp: fixtureTime(2)
      })
      await startRouted(PRIMARY_ROUTE)
      expect(recheck).toHaveBeenCalledWith(PRIMARY_ROUTE.subject, {
        workspace: { workspaceId: 'fixture-repo::/fixture/repo' },
        liveRunPrimary: {
          runId: harness.runId,
          ownerId: session.ownerId,
          agent: 'claude',
          model: 'claude-opus-5-5',
          effort: 'max'
        }
      })
    })

    it('gives no live-primary evidence while the primary session is still starting', async () => {
      getPrimarySessionStore(harness.owner).insertStarting({
        runId: harness.runId,
        launchOperationId: 'launch_fixture_2',
        permissionMode: 'manual',
        requestedModel: 'claude-opus-5-5',
        requestedEffort: 'max',
        timestamp: fixtureTime(1)
      })
      await startRouted(SUBAGENT_ROUTE)
      expect(recheck).toHaveBeenCalledWith(SUBAGENT_ROUTE.subject, {
        workspace: { workspaceId: 'fixture-repo::/fixture/repo' },
        liveRunPrimary: null
      })
    })

    it('names the workflow of a workflow route and refuses one without a workflow name', async () => {
      const named = await startRouted(WORKFLOW_ROUTE, { spec: { workflowName: 'release-notes' } })
      expect(named.started.view.instruction).toContain('`release-notes`')
      const unnamed = seedRoutedAppTask(harness, WORKFLOW_ROUTE)
      const error = await start(unnamed.taskId).catch((caught: unknown) => caught)
      expect(codeOf(error)).toBe('autopilot_workflow_name_missing')
      expect(harness.owner.getDispatchContext(unnamed.taskId)).toBeUndefined()
    })
  })
})

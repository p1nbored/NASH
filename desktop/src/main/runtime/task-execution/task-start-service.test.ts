// FIXTURE_ONLY: synthetic runs, routes and fake executors; no CLI, model, network or credential is used.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { TreeProof } from '../../agent-exec-shared/tree-termination'
import { isEnglishText } from '../../../shared/english-text'
import type {
  RouteAvailabilityResult,
  RouteSubject
} from '../../routing-table/availability/route-availability-types'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getExecutorProcessStore } from '../orchestration/db/executor-process-store'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getTaskRouteStore } from '../orchestration/db/task-route-store'
import { createExecutorRegistry, type ExecutorRegistry } from './executor-registry'
import type { AttemptPlacement } from './attempt-workspace'
import type { ExecutorRunReport } from './executor-run-report'
import type { ProcessAttemptPlan, ProcessTaskExecutor } from './process-executor-contract'
import type { TaskExecutionLogEvent } from './task-execution-ports'
import { createTaskStartService, type TaskStartService } from './task-start-service'
import type { RouteRecheckPort } from './task-start-route'
import {
  AGY_ROUTE,
  CODEX_ROUTE,
  FIXTURE_NOW_MS,
  PRIMARY_ROUTE,
  SUBAGENT_ROUTE,
  WORKFLOW_ROUTE,
  announceSpy,
  availableResult,
  completedReport,
  createAppRunHarness,
  deferred,
  seedKeptAppTask,
  seedRoutedAppTask,
  unavailableResult,
  type AnnounceSpy,
  type AppRunHarness,
  type RouteFixture
} from './task-execution.test-fixture'

const LAST_MESSAGE_TEXT = 'EXECUTOR-OUTPUT-SENTINEL'
const UNVERIFIABLE = { verdict: 'unverifiable', method: 'root_exit_only' } as const
const EXITED = { verdict: 'exited', method: 'windows_descendant_snapshot' } as const
const RUN_WORKSPACE: AttemptPlacement = { mode: 'run_workspace' }

type FakeRun = {
  readonly signal: AbortSignal
  readonly finish: (report: ExecutorRunReport) => void
}

function fakeExecutor(
  kind: 'codex_cli' | 'agy_cli',
  onAbort: TreeProof = UNVERIFIABLE,
  placement: AttemptPlacement = { mode: 'run_workspace' }
) {
  const runs: FakeRun[] = []
  const plans: ProcessAttemptPlan[] = []
  const executor: ProcessTaskExecutor = {
    kind,
    prepare: vi.fn(async (plan: ProcessAttemptPlan) => {
      plans.push(plan)
      return {
        ok: true as const,
        prepared: {
          evidence: { executor: kind, entryFile: 'fixture-cli' },
          placement,
          run: (signal: AbortSignal) =>
            new Promise<ExecutorRunReport>((resolve) => {
              runs.push({ signal, finish: resolve })
              signal.addEventListener('abort', () =>
                resolve(
                  completedReport({
                    verdict: { status: 'failed', failureKinds: ['cancelled'] },
                    cancellation: { requested: true, trigger: 'abort_signal', proof: onAbort },
                    treeProof: onAbort,
                    lastMessage: null
                  })
                )
              )
            })
        }
      }
    })
  }
  return { executor, runs, plans }
}

describe('task start service', () => {
  let harness: AppRunHarness
  let spy: AnnounceSpy
  let recheck: Mock<RouteRecheckPort['recheck']>
  let latch: Mock<RouteRecheckPort['latch']>
  let registry: ExecutorRegistry
  let codex: ReturnType<typeof fakeExecutor>
  let agy: ReturnType<typeof fakeExecutor>
  let service: TaskStartService
  let clock: number

  function recheckAnswers(result: (subject: RouteSubject) => RouteAvailabilityResult): void {
    recheck.mockImplementation(async (subject: RouteSubject) => result(subject))
  }

  beforeEach(() => {
    harness = createAppRunHarness()
    spy = announceSpy()
    clock = FIXTURE_NOW_MS
    recheck = vi.fn<RouteRecheckPort['recheck']>()
    latch = vi.fn<RouteRecheckPort['latch']>()
    codex = fakeExecutor('codex_cli')
    agy = fakeExecutor('agy_cli')
    const executors = getExecutorProcessStore(harness.owner)
    registry = createExecutorRegistry({
      recordedTree: (dispatchId) => {
        const record = executors.get(dispatchId)
        return record?.treeVerdict && record.treeMethod
          ? { verdict: record.treeVerdict, method: record.treeMethod }
          : null
      }
    })
    service = createTaskStartService({
      owner: harness.owner,
      routes: { recheck, latch },
      executors: { codex_cli: codex.executor, agy_cli: agy.executor },
      registry,
      now: () => (clock += 1000),
      cliCommand: 'orca',
      announce: spy.announce,
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
      expect(codex.executor.prepare).not.toHaveBeenCalled()
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
      expect(codex.executor.prepare).not.toHaveBeenCalled()
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

  describe('Codex and agy attempts', () => {
    it('starts a Codex attempt as a running app process and tells the primary not to do it', async () => {
      const { seeded, started } = await startRouted(CODEX_ROUTE)
      expect(started.view).toMatchObject({
        taskId: seeded.taskId,
        target: 'codex_cli',
        runsIn: 'process',
        workerState: 'ready'
      })
      expect(isEnglishText(started.view.instruction)).toBe(true)
      expect(started.view.instruction).toContain(
        `orca orchestration task-show --task ${seeded.taskId} --json`
      )
      const executor = getExecutorProcessStore(harness.owner).get(started.view.dispatchId)
      expect(executor).toMatchObject({
        state: 'running',
        routeId: started.view.routeId,
        executableEvidence: { executor: 'codex_cli', entryFile: 'fixture-cli' }
      })
      expect(started.view.routeId).not.toBe(seeded.routeId)
      expect(codex.plans[0]).toMatchObject({
        dispatchId: started.view.dispatchId,
        access: 'read_only',
        cli: { model: 'gpt-6.1-sol', effort: 'max' }
      })
      codex.runs[0]?.finish(completedReport())
      await started.settled
    })

    it('settles a claim: the task waits for validation and the notice carries no executor output', async () => {
      const { seeded, started } = await startRouted(CODEX_ROUTE)
      codex.runs[0]?.finish(
        completedReport({ lastMessage: { sha256: 'a'.repeat(64), bytes: 24, secretLike: true } })
      )
      await started.settled
      expect(harness.owner.getTask(seeded.taskId)?.status).toBe('blocked')
      expect(getExecutorProcessStore(harness.owner).get(started.view.dispatchId)).toMatchObject({
        state: 'completed',
        lastMessage: { sha256: 'a'.repeat(64), bytes: 24, secretLike: true },
        treeVerdict: 'unverifiable',
        treeMethod: 'root_exit_only'
      })
      expect(harness.owner.getWorkerDispatch(started.view.dispatchId)).toMatchObject({
        state: 'ready',
        stage: 'validation_pending'
      })
      expect(spy.messages).toHaveLength(1)
      const [notice] = spy.messages
      expect(notice).toMatchObject({ to_handle: `run:${harness.runId}`, type: 'status' })
      expect(isEnglishText(`${notice?.subject}\n${notice?.body}`)).toBe(true)
      expect(notice?.body).not.toContain(LAST_MESSAGE_TEXT)
      expect(notice?.body).toMatch(/masked/)
      expect(registry.holds(started.view.dispatchId)).toBe(false)
    })

    it('latches the route and fails the task when the executor reports a quota block', async () => {
      const { seeded, started } = await startRouted(AGY_ROUTE)
      agy.runs[0]?.finish(
        completedReport({
          verdict: { status: 'blocked', reason: 'quota', failureKinds: ['nonzero_exit'] },
          exitCode: 1,
          lastMessage: null
        })
      )
      await started.settled
      expect(latch).toHaveBeenCalledWith(AGY_ROUTE.subject, 'quota')
      expect(harness.owner.getTask(seeded.taskId)?.status).toBe('failed')
      expect(getExecutorProcessStore(harness.owner).get(started.view.dispatchId)?.state).toBe(
        'blocked'
      )
      expect(spy.messages[0]?.body).toMatch(/quota/)
    })

    it('names the own worktree of a write attempt in the reply to the primary (D-025)', async () => {
      codex = fakeExecutor('codex_cli', UNVERIFIABLE, {
        mode: 'own_worktree',
        worktree: {
          worktreeId: 'fixture-repo::C:/fixture/workspaces/nash-task-1',
          branch: 'nash-task-1',
          path: 'C:/fixture/workspaces/nash-task-1',
          baseCommit: '0123456789abcdef0123456789abcdef01234567'
        }
      })
      service = createTaskStartService({
        owner: harness.owner,
        routes: { recheck, latch },
        executors: { codex_cli: codex.executor, agy_cli: agy.executor },
        registry,
        now: () => (clock += 1000),
        cliCommand: 'orca',
        announce: spy.announce,
        log: () => undefined
      })
      const { started } = await startRouted(CODEX_ROUTE)
      expect(started.view.instruction).toContain('`nash-task-1`')
      expect(started.view.instruction).toMatch(/last commit/)
      codex.runs[0]?.finish(completedReport())
      await started.settled
    })

    it('never sends agy an effort and hands the executor the run access', async () => {
      await startRouted(AGY_ROUTE)
      expect(agy.plans[0]?.cli).toEqual({ model: 'gemini-3.8-flash-high', effort: null })
      agy.runs[0]?.finish(completedReport())
    })

    it.each([
      [EXITED, 'stopped', 'stopped'],
      [UNVERIFIABLE, 'stop_unknown', 'stop_unknown']
    ] as const)(
      'stops through the executor port (%o gives %s)',
      async (proof, executorState, workerState) => {
        codex = fakeExecutor('codex_cli', proof)
        service = createTaskStartService({
          owner: harness.owner,
          routes: { recheck, latch },
          executors: { codex_cli: codex.executor, agy_cli: agy.executor },
          registry,
          now: () => (clock += 1000),
          cliCommand: 'orca',
          announce: spy.announce,
          log: () => undefined
        })
        const { started } = await startRouted(CODEX_ROUTE)
        harness.owner.beginWorkerStop(started.view.dispatchId, 'fixture_epoch')
        const outcome = await registry.stopExecutor({
          dispatchId: started.view.dispatchId,
          kind: 'codex_cli'
        })
        expect(outcome).toEqual(proof)
        expect(getExecutorProcessStore(harness.owner).get(started.view.dispatchId)).toMatchObject({
          state: executorState,
          stopVerdict: proof.verdict
        })
        expect(harness.owner.getWorkerDispatch(started.view.dispatchId)?.state).toBe(workerState)
      }
    )

    it('aborts every child on quit and records the stop as unknown when the tree is unproven', async () => {
      const first = await startRouted(CODEX_ROUTE)
      const second = await startRouted(AGY_ROUTE)
      await registry.abortAll()
      expect(codex.runs[0]?.signal.aborted).toBe(true)
      expect(agy.runs[0]?.signal.aborted).toBe(true)
      await Promise.all([first.started.settled, second.started.settled])
      for (const { started } of [first, second]) {
        expect(getExecutorProcessStore(harness.owner).get(started.view.dispatchId)).toMatchObject({
          state: 'stop_unknown',
          verdict: { reason: 'app_quit' }
        })
      }
      const late = seedRoutedAppTask(harness, CODEX_ROUTE)
      recheckAnswers(() => availableResult(CODEX_ROUTE))
      const view = (await start(late.taskId)).view
      expect(view.workerState).toBe('failed')
      expect(getExecutorProcessStore(harness.owner).get(view.dispatchId)).toMatchObject({
        state: 'failed',
        verdict: { reason: 'app_quitting' }
      })
    })

    it('refuses a process start whose Orca task row is gone, before it opens an attempt', async () => {
      const seeded = seedRoutedAppTask(harness, CODEX_ROUTE)
      recheckAnswers(() => availableResult(CODEX_ROUTE))
      vi.spyOn(harness.owner, 'getTask').mockReturnValue(undefined)
      const error = await start(seeded.taskId).catch((caught: unknown) => caught)
      expect(codeOf(error)).toBe('autopilot_task_not_found')
      expect(codex.executor.prepare).not.toHaveBeenCalled()
      vi.restoreAllMocks()
      expect(harness.owner.getDispatchContext(seeded.taskId)).toBeUndefined()
    })

    it('fails the start without running anything when the executor cannot be prepared', async () => {
      const seeded = seedRoutedAppTask(harness, CODEX_ROUTE)
      recheckAnswers(() => availableResult(CODEX_ROUTE))
      vi.mocked(codex.executor.prepare).mockResolvedValueOnce({
        ok: false,
        reason: 'workspace_unavailable'
      })
      const { view, settled } = await start(seeded.taskId)
      await settled
      expect(view.workerState).toBe('failed')
      expect(harness.owner.getTask(seeded.taskId)?.status).toBe('failed')
      expect(getExecutorProcessStore(harness.owner).get(view.dispatchId)).toMatchObject({
        state: 'failed',
        treeVerdict: 'exited',
        treeMethod: 'not_started'
      })
      expect(spy.messages[0]?.body).toContain('workspace_unavailable')
      expect(codex.runs).toHaveLength(0)
    })

    it.each([
      ['a stop request', 'stop_requested'],
      ['an app quit', 'app_quit']
    ] as const)(
      'settles %s that arrives while the launch is prepared as stopped, with nothing run',
      async (_label, reason) => {
        const seeded = seedRoutedAppTask(harness, CODEX_ROUTE)
        recheckAnswers(() => availableResult(CODEX_ROUTE))
        const gate = deferred<void>()
        const run = vi.fn()
        vi.mocked(codex.executor.prepare).mockImplementationOnce(async () => {
          await gate.promise
          return {
            ok: true as const,
            prepared: { evidence: { executor: 'codex_cli' }, placement: RUN_WORKSPACE, run }
          }
        })
        const starting = start(seeded.taskId)
        await vi.waitFor(() =>
          expect(harness.owner.getDispatchContext(seeded.taskId)).toBeDefined()
        )
        const dispatchId = harness.owner.getDispatchContext(seeded.taskId)?.id ?? ''
        const stopped =
          reason === 'stop_requested'
            ? registry.stopExecutor({ dispatchId, kind: 'codex_cli' })
            : registry.abortAll().then(() => null)
        gate.resolve()
        const { view } = await starting
        expect(view.workerState).toBe('stopped')
        if (reason === 'stop_requested') {
          await expect(stopped).resolves.toEqual({ verdict: 'exited', method: 'not_started' })
        }
        await stopped
        expect(run).not.toHaveBeenCalled()
        expect(getExecutorProcessStore(harness.owner).get(dispatchId)).toMatchObject({
          state: 'stopped',
          stopVerdict: 'exited',
          treeMethod: 'not_started',
          verdict: { reason }
        })
      }
    )

    describe('a start abandoned after its own worktree was created (D-025)', () => {
      const LEFT: AttemptPlacement = {
        mode: 'own_worktree',
        worktree: {
          worktreeId: 'fixture-repo::C:/fixture/workspaces/nash-task-1',
          branch: 'nash-task-1',
          path: 'C:/fixture/workspaces/nash-task-1',
          baseCommit: '0123456789abcdef0123456789abcdef01234567'
        }
      }
      let log: Mock<(event: TaskExecutionLogEvent) => void>

      beforeEach(() => {
        log = vi.fn<(event: TaskExecutionLogEvent) => void>()
        service = createTaskStartService({
          owner: harness.owner,
          routes: { recheck, latch },
          executors: { codex_cli: codex.executor, agy_cli: agy.executor },
          registry,
          now: () => (clock += 1000),
          cliCommand: 'orca',
          announce: spy.announce,
          log
        })
      })

      it('logs worktree_left_behind and records the branch and path when a stop came during prepare', async () => {
        const seeded = seedRoutedAppTask(harness, CODEX_ROUTE)
        recheckAnswers(() => availableResult(CODEX_ROUTE))
        const gate = deferred<void>()
        const run = vi.fn()
        vi.mocked(codex.executor.prepare).mockImplementationOnce(async () => {
          await gate.promise
          return {
            ok: true as const,
            prepared: { evidence: { executor: 'codex_cli' }, placement: LEFT, run }
          }
        })
        const starting = start(seeded.taskId)
        await vi.waitFor(() =>
          expect(harness.owner.getDispatchContext(seeded.taskId)).toBeDefined()
        )
        const dispatchId = harness.owner.getDispatchContext(seeded.taskId)?.id ?? ''
        const stopped = registry.stopExecutor({ dispatchId, kind: 'codex_cli' })
        gate.resolve()
        expect((await starting).view.workerState).toBe('stopped')
        await stopped
        expect(run).not.toHaveBeenCalled()
        expect(log).toHaveBeenCalledWith({ event: 'worktree_left_behind', dispatchId })
        expect(getExecutorProcessStore(harness.owner).get(dispatchId)?.verdict).toEqual({
          reason: 'stop_requested',
          worktreeLeftBehind: { branch: 'nash-task-1', path: 'C:/fixture/workspaces/nash-task-1' }
        })
      })

      it('logs worktree_left_behind and records the branch and path when marking it running fails', async () => {
        const seeded = seedRoutedAppTask(harness, CODEX_ROUTE)
        recheckAnswers(() => availableResult(CODEX_ROUTE))
        const run = vi.fn()
        // Evidence past the column bound makes the running write refuse after prepare succeeded.
        vi.mocked(codex.executor.prepare).mockResolvedValueOnce({
          ok: true,
          prepared: {
            evidence: { executor: 'codex_cli', padding: 'x'.repeat(5000) },
            placement: LEFT,
            run
          }
        })
        await expect(start(seeded.taskId)).rejects.toThrow()
        const dispatchId = harness.owner.getDispatchContext(seeded.taskId)?.id ?? ''
        expect(run).not.toHaveBeenCalled()
        expect(log).toHaveBeenCalledWith({ event: 'worktree_left_behind', dispatchId })
        expect(getExecutorProcessStore(harness.owner).get(dispatchId)).toMatchObject({
          state: 'failed',
          verdict: {
            reason: 'executor_mark_running_failed',
            worktreeLeftBehind: { branch: 'nash-task-1', path: 'C:/fixture/workspaces/nash-task-1' }
          }
        })
      })

      it('logs nothing about a worktree when the abandoned start ran in the run workspace', async () => {
        const seeded = seedRoutedAppTask(harness, CODEX_ROUTE)
        recheckAnswers(() => availableResult(CODEX_ROUTE))
        vi.mocked(codex.executor.prepare).mockResolvedValueOnce({
          ok: true,
          prepared: {
            evidence: { executor: 'codex_cli', padding: 'x'.repeat(5000) },
            placement: RUN_WORKSPACE,
            run: vi.fn()
          }
        })
        await expect(start(seeded.taskId)).rejects.toThrow()
        expect(log).not.toHaveBeenCalledWith(
          expect.objectContaining({ event: 'worktree_left_behind' })
        )
      })
    })

    it('retries a failed task from its last attempt on the next explicit start', async () => {
      const { seeded, started } = await startRouted(CODEX_ROUTE)
      codex.runs[0]?.finish(
        completedReport({
          verdict: { status: 'failed', failureKinds: ['nonzero_exit'] },
          exitCode: 1,
          lastMessage: null
        })
      )
      await started.settled
      expect(harness.owner.getTask(seeded.taskId)?.status).toBe('failed')
      const again = await start(seeded.taskId)
      expect(again.view.dispatchId).not.toBe(started.view.dispatchId)
      expect(harness.owner.getDispatchContextById(again.view.dispatchId)).toMatchObject({
        retry_of_dispatch_id: started.view.dispatchId
      })
      codex.runs[1]?.finish(completedReport())
      await again.settled
    })
  })

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
      expect(getExecutorProcessStore(harness.owner).get(started.view.dispatchId)).toBeNull()
      expect(codex.executor.prepare).not.toHaveBeenCalled()
      expect(agy.executor.prepare).not.toHaveBeenCalled()
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
      expect(getExecutorProcessStore(harness.owner).get(view.dispatchId)).toBeNull()
      expect(codex.executor.prepare).not.toHaveBeenCalled()
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
        liveRunPrimary: { runId: harness.runId, ownerId: session.ownerId }
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

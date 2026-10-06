import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBundledRoutingTable } from '../../routing-table/routing-table-bundle'
import type { RouteAvailabilityResult } from '../../routing-table/availability/route-availability-types'
import type { CoordinatorResolution } from '../../routing-table/route-resolver'
import type { ResolvedRoutingTable } from '../../routing-table/routing-table-activation'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { workbenchWorkspaceBinding } from '../orchestration/db/workbench-request-scope'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import type { WorkbenchLocalWorkspace } from '../workbench-local-workspace'
import type {
  PrimarySessionLaunchOutcome,
  PrimarySessionLaunchRequest
} from './primary-session-launcher'
import { createWorkflowRunService, type WorkflowRunServiceDeps } from './workflow-run-service'
import { fakeClock } from './primary-session.test-fixture'

const TABLE = getBundledRoutingTable()
const TABLE_SHA = 'd'.repeat(64)
const WORKSPACE: WorkbenchLocalWorkspace = {
  workspaceId: 'fixture-repo::/fixture/repo',
  projectId: 'fixture-project',
  projectKind: 'project',
  hostId: 'local',
  path: '/fixture/repo'
}
const BINDING = workbenchWorkspaceBinding(WORKSPACE.workspaceId, WORKSPACE)

function availability(status: 'available' | 'unverified'): RouteAvailabilityResult {
  const subject = {
    target: 'claude_primary' as const,
    model: TABLE.coordinator.model,
    reasoningLevel: TABLE.coordinator.reasoning_level,
    requirement: 'required' as const,
    inheritsCoordinator: false
  }
  const snapshot = {
    checkedAtMs: 1,
    freshness: 'dispatch' as const,
    workspaceKind: null,
    checks: [],
    observedAtMs: { detection: 1, models: 1, rateLimits: 1 }
  }
  return status === 'available'
    ? {
        subject,
        snapshot,
        status,
        reasons: [],
        cli: {
          target: 'claude_primary',
          model: TABLE.coordinator.model,
          effort: TABLE.coordinator.reasoning_level,
          effortDelivery: 'claude_effort_flag',
          requestedLevel: TABLE.coordinator.reasoning_level,
          requirement: 'required',
          resolution: 'applied'
        }
      }
    : { subject, snapshot, status, reasons: ['auth_unobserved'], cli: null }
}

function coordinatorWith(status: 'available' | 'unverified'): CoordinatorResolution {
  return {
    ok: true,
    table: { version: 3, sha256: TABLE_SHA },
    coordinator: {
      model: TABLE.coordinator.model,
      reasoningLevel: TABLE.coordinator.reasoning_level
    },
    availability: availability(status)
  }
}

describe('workflow run service', () => {
  let db: OrchestrationDb
  let deps: WorkflowRunServiceDeps
  let coordinator: CoordinatorResolution
  let active: ResolvedRoutingTable

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    coordinator = coordinatorWith('available')
    active = { ok: true, table: TABLE, version: 3, sha256: TABLE_SHA, source: 'bundled' }
    deps = {
      db,
      workspaces: { require: vi.fn(() => WORKSPACE) },
      routing: {
        resolver: { resolveCoordinator: vi.fn(async () => coordinator) },
        activeTable: () => active
      },
      launcher: {
        launch: vi.fn(
          async (request: PrimarySessionLaunchRequest): Promise<PrimarySessionLaunchOutcome> => ({
            ok: false,
            blocker: {
              reason: 'launch_blocked',
              detail: 'launch_refused',
              code: 'fixture_refusal',
              message: 'Fixture.'
            },
            run: request.run,
            owner: null
          })
        )
      },
      clock: fakeClock()
    }
  })
  afterEach(() => db.close())

  const input = (overrides: Record<string, unknown> = {}) => ({
    requestId: 'request_service01',
    workspaceId: WORKSPACE.workspaceId,
    workspaceBinding: BINDING,
    objective: 'Summarize the repository.',
    requestedAccess: 'read_only' as const,
    deliverableLanguage: null,
    ...overrides
  })

  const start = (overrides: Record<string, unknown> = {}) =>
    createWorkflowRunService(deps).startWorkflowRun(input(overrides))

  it('creates the Orca run and the workflow run, then launches the primary with the table rows', async () => {
    const result = await start()
    const launch = vi.mocked(deps.launcher.launch)
    expect(launch).toHaveBeenCalledOnce()
    const request = launch.mock.calls[0][0]
    expect(db.getRun(request.run.runId)).toMatchObject({ objective: 'Summarize the repository.' })
    expect(request.run).toMatchObject({
      requestId: 'request_service01',
      status: 'launching',
      workspaceBinding: BINDING,
      routingTableVersion: 3,
      routingTableSha256: TABLE_SHA,
      coordinatorModel: TABLE.coordinator.model,
      coordinatorEffort: TABLE.coordinator.reasoning_level
    })
    expect(request.workspacePath).toBe('/fixture/repo')
    expect(request.routeRows).toHaveLength(TABLE.routes.length)
    expect(request.routeRows[0]).toEqual({
      taskType: TABLE.routes[0].task_type,
      executionTarget: TABLE.routes[0].execution_target,
      model: TABLE.routes[0].model,
      effort: TABLE.routes[0].reasoning_level
    })
    expect(vi.mocked(deps.routing.resolver.resolveCoordinator)).toHaveBeenCalledWith({
      workspace: { workspaceId: WORKSPACE.workspaceId },
      freshness: 'dispatch'
    })
    expect(result).toMatchObject({
      ok: false,
      blocker: { code: 'fixture_refusal' },
      run: { runId: request.run.runId }
    })
  })

  it('never touches a Workbench row', async () => {
    await start()
    const workbench = db.db
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'workbench_%'")
      .all()
    expect(workbench).toEqual([])
  })

  it('starts nothing for a duplicate request and returns the existing run', async () => {
    await start()
    const runsBefore = db.listRuns().runs.length
    const again = await start()
    expect(again).toMatchObject({
      ok: true,
      duplicate: true,
      run: { requestId: 'request_service01' }
    })
    expect(deps.launcher.launch).toHaveBeenCalledOnce()
    expect(db.listRuns().runs).toHaveLength(runsBefore)
  })

  it('joins a concurrent start of the same request', async () => {
    const service = createWorkflowRunService(deps)
    await Promise.all([service.startWorkflowRun(input()), service.startWorkflowRun(input())])
    expect(deps.launcher.launch).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'an unverified coordinator route',
      () => (coordinator = coordinatorWith('unverified')),
      'autopilot_coordinator_route_unavailable'
    ],
    [
      'no installed routing table',
      () => (coordinator = { ok: false, reason: 'routing_table_not_installed' }),
      'routing_table_not_installed'
    ],
    [
      'a table that changed between reads',
      () =>
        (active = {
          ...active,
          ok: true,
          table: TABLE,
          version: 4,
          sha256: TABLE_SHA,
          source: 'user'
        }),
      'autopilot_routing_table_changed'
    ]
  ])(
    'blocks %s with coordinator_route_unavailable and substitutes nothing',
    async (_label, arrange, code) => {
      arrange()
      await expect(start()).resolves.toMatchObject({
        ok: false,
        blocker: { reason: 'launch_blocked', detail: 'coordinator_route_unavailable', code },
        run: null,
        owner: null
      })
      expect(deps.launcher.launch).not.toHaveBeenCalled()
      expect(getWorkflowRunStore(db).getByRequestId('request_service01')).toBeNull()
      expect(
        db.listRuns().runs.filter((run) => run.objective === 'Summarize the repository.')
      ).toEqual([])
    }
  )

  it('refuses when the workspace binding no longer matches', async () => {
    await expect(start({ workspaceBinding: 'e'.repeat(64) })).resolves.toMatchObject({
      ok: false,
      blocker: { detail: 'launch_refused', code: 'autopilot_launch_workspace_changed' },
      run: null
    })
    expect(
      db.listRuns().runs.filter((run) => run.objective === 'Summarize the repository.')
    ).toEqual([])
  })

  it('refuses when the workspace is no longer admitted', async () => {
    vi.mocked(deps.workspaces.require).mockImplementationOnce(() => {
      throw new OrchestrationError('workbench_workspace_unavailable', 'gone')
    })
    await expect(start()).resolves.toMatchObject({
      ok: false,
      blocker: { detail: 'launch_refused', code: 'workbench_workspace_unavailable' }
    })
    expect(deps.routing.resolver.resolveCoordinator).not.toHaveBeenCalled()
  })

  it('refuses malformed input before reading anything', async () => {
    await expect(start({ requestId: 'has space' })).resolves.toMatchObject({
      ok: false,
      blocker: { code: 'autopilot_invalid_input' }
    })
    expect(deps.workspaces.require).not.toHaveBeenCalled()
  })

  describe('the Orca run is created only once the app record can be written', () => {
    const orphans = () =>
      db.listRuns().runs.filter((run) => run.objective === 'Summarize the repository.')

    it('refuses a deliverable language the run store would refuse, before reading anything', async () => {
      await expect(start({ deliverableLanguage: 'English (US)' })).resolves.toMatchObject({
        ok: false,
        blocker: { detail: 'launch_refused', code: 'autopilot_invalid_input' },
        run: null
      })
      expect(deps.workspaces.require).not.toHaveBeenCalled()
      expect(orphans()).toEqual([])
    })

    it('refuses a create input the run store would refuse, before creating the Orca run', async () => {
      const available = coordinatorWith('available')
      if (!available.ok) {
        throw new Error('fixture: expected an available coordinator')
      }
      coordinator = { ...available, table: { version: 0, sha256: TABLE_SHA } }
      active = { ok: true, table: TABLE, version: 0, sha256: TABLE_SHA, source: 'bundled' }
      await expect(start()).resolves.toMatchObject({
        ok: false,
        blocker: { detail: 'launch_refused', code: 'autopilot_invalid_input' },
        run: null,
        owner: null
      })
      expect(deps.launcher.launch).not.toHaveBeenCalled()
      expect(orphans()).toEqual([])
    })

    it('returns a run another start recorded meanwhile without creating an Orca run', async () => {
      vi.mocked(deps.routing.resolver.resolveCoordinator).mockImplementationOnce(async () => {
        const other = db.createRun({
          objective: 'Recorded by another start.',
          coordinatorHandle: null,
          coordinatorPaneKey: null
        })
        getWorkflowRunStore(db).create({
          runId: other.id,
          requestId: 'request_service01',
          workspaceId: WORKSPACE.workspaceId,
          workspaceBinding: BINDING,
          requestedAccess: 'read_only',
          deliverableLanguage: null,
          routingTableVersion: 3,
          routingTableSha256: TABLE_SHA,
          coordinatorModel: TABLE.coordinator.model,
          coordinatorEffort: 'max',
          timestamp: '2026-10-05T00:00:00.000Z'
        })
        return coordinator
      })
      await expect(start()).resolves.toMatchObject({
        ok: true,
        duplicate: true,
        run: { requestId: 'request_service01' }
      })
      expect(deps.launcher.launch).not.toHaveBeenCalled()
      expect(orphans()).toEqual([])
    })

    it('answers with a blocker instead of rejecting when the app record cannot be written', async () => {
      vi.spyOn(getWorkflowRunStore(db), 'create').mockImplementationOnce(() => {
        throw new OrchestrationError('autopilot_run_conflict', 'Fixture conflict.')
      })
      await expect(start()).resolves.toMatchObject({
        ok: false,
        blocker: { detail: 'launch_refused', code: 'autopilot_run_conflict' },
        run: null,
        owner: null
      })
      expect(deps.launcher.launch).not.toHaveBeenCalled()
    })
  })

  it('returns the run and owner of a successful launch', async () => {
    vi.mocked(deps.launcher.launch).mockImplementationOnce(async (request) => ({
      ok: true,
      run: { ...request.run, status: 'active' },
      owner: {
        ownerId: 'owner_fixture',
        runId: request.run.runId,
        generation: 1,
        launchOperationId: 'operation_fixture',
        launchLedger: 'orca',
        terminalHandle: 'term_a',
        paneKey: 'tab:leaf',
        processIncarnation: 'incarnation_a',
        launchTokenSha256: null,
        permissionMode: 'manual',
        requestedModel: 'claude-opus-5-5',
        requestedEffort: 'max',
        state: 'running',
        receipt: { mode: 'terminal' },
        endReason: null,
        startedAt: '2026-10-05T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
        endedAt: null
      }
    }))
    await expect(start()).resolves.toMatchObject({
      ok: true,
      duplicate: false,
      run: { status: 'active' }
    })
  })
})

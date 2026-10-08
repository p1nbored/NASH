// FIXTURE_ONLY: every id, path, hash and objective below is synthetic and describes no real request.
import type {
  WorkbenchCancelInput,
  WorkbenchSubmitInput
} from '../../../shared/rpc-contract/workbench-params'
import type { DotRequestAccess } from '../../../shared/dot-ingress/dot-ingress-limits'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { workbenchWorkspaceBinding } from '../orchestration/db/workbench-request-scope'
import { getWorkbenchRequestStore } from '../orchestration/db/workbench-request-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { MessageRow } from '../orchestration/types'
import type { WorkbenchLocalWorkspace } from '../workbench-local-workspace'
import type { WorkbenchIntakeTarget } from '../workbench-intake-submit'
import type {
  DotDecisionRelay,
  DotIngressServiceDeps,
  DotIntakeDoor,
  DotRunMessenger
} from './dot-ingress-ports'
import type { DotSubmitRequest } from './dot-ingress-intake'

export const FIXTURE_WORKSPACE: WorkbenchLocalWorkspace = {
  workspaceId: 'fixture-repo::/fixture/repo',
  projectId: 'fixture-project',
  projectKind: 'project',
  hostId: 'local',
  path: '/fixture/repo'
}
export const FIXTURE_BINDING = workbenchWorkspaceBinding(
  FIXTURE_WORKSPACE.workspaceId,
  FIXTURE_WORKSPACE
)
export const FIXTURE_NOW_MS = Date.parse('2026-10-05T00:00:10.000Z')
export const FIXTURE_OBJECTIVE = 'Summarize the open issues in `docs/plan.md` and list the owners.'

/** A uuid-shaped id that z.uuid() accepts; n makes it distinct. */
export function fixtureUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

/** What the fake door does after it records the request, standing in for the intake package's launch. */
export type LaunchMode = 'launched' | 'received' | 'blocked'

export type FakeDoor = DotIntakeDoor & {
  readonly submits: { target: WorkbenchIntakeTarget; params: WorkbenchSubmitInput }[]
  readonly cancels: { target: WorkbenchIntakeTarget; params: WorkbenchCancelInput }[]
  launch: LaunchMode
  /** Thrown once by the next submit, before anything is recorded. */
  failNextSubmit: unknown
  /** Thrown by every cancel while set. */
  failCancel: unknown
}

function revisionTarget(target: WorkbenchIntakeTarget, requestId: string, revision: number) {
  return { workspaceId: target.workspace.workspaceId, requestId, expectedRevision: revision }
}

function createFakeDoor(owner: OrchestrationDb, now: () => string): FakeDoor {
  let runs = 0
  const door: FakeDoor = {
    submits: [],
    cancels: [],
    launch: 'launched',
    failNextSubmit: null,
    failCancel: null,
    submit(target, params) {
      door.submits.push({ target, params })
      if (door.failNextSubmit !== null) {
        const failure = door.failNextSubmit
        door.failNextSubmit = null
        throw failure
      }
      const recorded = target.store.submit(target.principalId, params, target.workspace)
      if (recorded.duplicate || door.launch === 'received') {
        return recorded
      }
      const { store, principalId, workspace } = target
      const id = recorded.request.requestId
      const launching = store.advance(
        principalId,
        revisionTarget(target, id, recorded.request.revision),
        workspace,
        { to: 'LAUNCHING' }
      )
      if (door.launch === 'blocked') {
        const blocker = {
          reason: 'launch_blocked',
          detail: 'coordinator_route_unavailable'
        } as const
        const request = store.advance(
          principalId,
          revisionTarget(target, id, launching.revision),
          workspace,
          { to: 'LAUNCH_BLOCKED', blocker }
        )
        return { request, duplicate: false }
      }
      runs += 1
      const runId = `run-fixture-${runs}`
      const runStore = getWorkflowRunStore(owner)
      const { run } = runStore.create({
        runId,
        requestId: id,
        workspaceId: workspace.workspaceId,
        workspaceBinding: FIXTURE_BINDING,
        requestedAccess: params.requestedAccess ?? 'read_only',
        routingTableVersion: 1,
        routingTableSha256: 'b'.repeat(64),
        coordinatorAgent: 'claude',
        coordinatorModel: 'claude-opus-5-5',
        coordinatorEffort: 'max',
        timestamp: now()
      })
      runStore.transition({
        runId,
        from: 'launching',
        to: 'active',
        expectedRevision: run.revision,
        reason: null,
        timestamp: now()
      })
      const request = store.advance(
        principalId,
        revisionTarget(target, id, launching.revision),
        workspace,
        { to: 'LAUNCHED', workflowRunId: runId }
      )
      return { request, duplicate: false }
    },
    cancel(target, params) {
      door.cancels.push({ target, params })
      if (door.failCancel !== null) {
        throw door.failCancel
      }
      const { store, principalId, workspace } = target
      const current = store.get(
        principalId,
        { workspaceId: params.workspaceId, requestId: params.requestId },
        workspace
      )
      if (current.status !== 'ROUTED' || current.workflowRunId === null) {
        return store.cancel(principalId, params, workspace)
      }
      // Stands in for the intake package's stop path: the run ends before the request is canceled.
      const runStore = getWorkflowRunStore(owner)
      const run = runStore.get(current.workflowRunId)
      if (run && run.status === 'active') {
        runStore.transition({
          runId: run.runId,
          from: 'active',
          to: 'canceled',
          expectedRevision: run.revision,
          reason: 'user_canceled',
          timestamp: now()
        })
      }
      const request = store.advance(
        principalId,
        revisionTarget(target, params.requestId, params.expectedRevision),
        workspace,
        { to: 'CANCELED' }
      )
      return { request, changed: true }
    }
  }
  return door
}

export type DotHarness = {
  readonly owner: OrchestrationDb
  readonly deps: DotIngressServiceDeps
  readonly door: FakeDoor
  readonly workspaceRef: string
  /** Notices a validation decision announced, in order. */
  readonly announced: MessageRow[]
  advanceClock(ms: number): void
  setRelay(relay: DotDecisionRelay | null): void
  setMessenger(messenger: DotRunMessenger | null): void
  /** What the app's catalog admits for the fixture workspace id now; null as for a removed project. */
  setWorkspace(workspace: WorkbenchLocalWorkspace | null): void
  submitRequest(overrides?: Partial<DotSubmitRequest>): DotSubmitRequest
  close(): void
}

export function createDotHarness(
  options: { enabled?: boolean; maxAccess?: DotRequestAccess } = {}
): DotHarness {
  const owner = new OrchestrationDb(':memory:')
  let nowMs = FIXTURE_NOW_MS
  const iso = (): string => new Date(nowMs).toISOString()
  const settings = getDotIngressSettingsStore(owner)
  settings.setRateLimits({ ratePerMinute: 60, ratePerUtcDay: 10_000, timestamp: iso() })
  if (options.enabled !== false) {
    settings.setEnabled({ enabled: true, timestamp: iso() })
  }
  const workspaceRef = settings.enableWorkspace({
    workspaceId: FIXTURE_WORKSPACE.workspaceId,
    workspaceBinding: FIXTURE_BINDING,
    label: 'fixture-repo',
    ...(options.maxAccess ? { maxAccess: options.maxAccess } : {}),
    timestamp: iso()
  }).workspace.workspaceRef
  // Opening the Workbench store early keeps its schema out of the timing of the first submit.
  getWorkbenchRequestStore(owner)
  const door = createFakeDoor(owner, iso)
  let relay: DotDecisionRelay | null = null
  let messenger: DotRunMessenger | null = null
  let admitted: WorkbenchLocalWorkspace | null = FIXTURE_WORKSPACE
  const announced: MessageRow[] = []
  const deps: DotIngressServiceDeps = {
    db: owner,
    requireWorkspace: (workspaceId) => {
      if (!admitted || workspaceId !== FIXTURE_WORKSPACE.workspaceId) {
        throw new OrchestrationError(
          'workbench_workspace_unavailable',
          'Fixture workspace is gone.'
        )
      }
      return admitted
    },
    door,
    relay: () => {
      if (!relay) {
        throw new OrchestrationError(
          'autopilot_permission_relay_unavailable',
          'Fixture relay is off.'
        )
      }
      return relay
    },
    messenger: () => {
      if (!messenger) {
        throw new OrchestrationError('autopilot_primary_session_not_configured', 'Fixture off.')
      }
      return messenger
    },
    announce: (message) => announced.push(message),
    now: () => new Date(nowMs)
  }
  return {
    owner,
    deps,
    door,
    workspaceRef,
    announced,
    advanceClock: (ms) => {
      nowMs += ms
    },
    setRelay: (next) => {
      relay = next
    },
    setMessenger: (next) => {
      messenger = next
    },
    setWorkspace: (workspace) => {
      admitted = workspace
    },
    submitRequest: (overrides = {}) => ({
      workspaceRef,
      objective: FIXTURE_OBJECTIVE,
      requestedAccess: 'read_only',
      idempotencyKey: fixtureUuid(1),
      ...overrides
    }),
    close: () => owner.close()
  }
}

/** The OrchestrationError code an async call rejected with, or null when it resolved. */
export async function rejectionCodeOf(operation: () => Promise<unknown>): Promise<string | null> {
  try {
    await operation()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : `unexpected: ${String(error)}`
  }
}

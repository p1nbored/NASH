import type { RouteBlocker } from '../../shared/clef/clef-route-contract'
import type { WorkbenchRequest } from '../../shared/workbench-request'
import type { OrchestrationDb } from './orchestration/db/orchestration-db'
import { workbenchWorkspaceBinding } from './orchestration/db/workbench-request-scope'
import { readWorkbenchRequestSettings } from './orchestration/db/workbench-request-settings'
import type {
  WorkbenchLaunchChange,
  WorkbenchRequestStore
} from './orchestration/db/workbench-request-store'
import { getWorkflowRunStore } from './orchestration/db/workflow-run-store'
import type { WorkbenchLocalWorkspace } from './workbench-local-workspace'
import {
  errorCodeOf,
  launchBlocker,
  type WorkflowRunLaunchBlocker
} from './workflow-run/primary-session-ports'
import {
  getPrimarySessionRuntime,
  type PrimarySessionRuntime
} from './workflow-run/primary-session-runtime'
import type {
  StartWorkflowRunInput,
  StartWorkflowRunResult
} from './workflow-run/workflow-run-service'

/** The admitted caller, workspace and stores a launch writes through (the door's own target). */
export type WorkbenchLaunchTarget = {
  readonly owner: OrchestrationDb
  readonly store: WorkbenchRequestStore
  readonly principalId: string
  readonly workspace: WorkbenchLocalWorkspace
}

export type WorkflowRunStarter = Pick<PrimarySessionRuntime, 'startWorkflowRun'>

export type WorkbenchLaunchOutcome =
  | { readonly kind: 'launched'; readonly request: WorkbenchRequest; readonly runId: string }
  | {
      readonly kind: 'blocked'
      readonly request: WorkbenchRequest
      readonly blocker: WorkflowRunLaunchBlocker
    }
  /** Nothing was started, or the receipt could not record the outcome; the code says why. */
  | { readonly kind: 'not_launched'; readonly code: string }

const launches = new Map<string, Promise<WorkbenchLaunchOutcome>>()

function storedBlocker(blocker: WorkflowRunLaunchBlocker): RouteBlocker {
  return { reason: blocker.reason, detail: blocker.detail }
}

function advance(
  target: WorkbenchLaunchTarget,
  request: WorkbenchRequest,
  change: WorkbenchLaunchChange
): WorkbenchRequest {
  return target.store.advance(
    target.principalId,
    {
      workspaceId: request.workspaceId,
      requestId: request.requestId,
      expectedRevision: request.revision
    },
    target.workspace,
    change
  )
}

function blocked(
  target: WorkbenchLaunchTarget,
  request: WorkbenchRequest,
  blocker: WorkflowRunLaunchBlocker,
  workflowRunId: string | null
): WorkbenchLaunchOutcome {
  const next = advance(target, request, {
    to: 'LAUNCH_BLOCKED',
    blocker: storedBlocker(blocker),
    ...(workflowRunId === null ? {} : { workflowRunId })
  })
  console.warn(`[workbench-intake] launch blocked: ${blocker.detail} ${blocker.code}`)
  return { kind: 'blocked', request: next, blocker }
}

/** A start that threw: whether it left a run decides between refused and unverifiable. */
function thrownStart(
  owner: OrchestrationDb,
  requestId: string,
  error: unknown
): StartWorkflowRunResult {
  const run = getWorkflowRunStore(owner).getByRequestId(requestId)
  const code = errorCodeOf(error)
  return run
    ? {
        ok: false,
        blocker: launchBlocker(
          'launch_unverifiable',
          code,
          'The launch failed after the run was created.'
        ),
        run,
        owner: null
      }
    : {
        ok: false,
        blocker: launchBlocker(
          'launch_refused',
          code,
          'The launch failed before the run was created.'
        ),
        run: null,
        owner: null
      }
}

/** The start input from the stored receipt and settings, which are the source of truth for a launch. */
function startInput(
  target: WorkbenchLaunchTarget,
  received: WorkbenchRequest
): StartWorkflowRunInput | WorkflowRunLaunchBlocker {
  try {
    const settings = readWorkbenchRequestSettings(target.owner.db, received.requestId)
    return {
      requestId: received.requestId,
      workspaceId: received.workspaceId,
      workspaceBinding: workbenchWorkspaceBinding(received.workspaceId, target.workspace),
      objective: received.objective,
      requestedAccess: settings.requestedAccess,
      deliverableLanguage: settings.deliverableLanguage
    }
  } catch (error) {
    return launchBlocker('launch_refused', errorCodeOf(error), 'The request cannot start.')
  }
}

async function launchSteps(
  target: WorkbenchLaunchTarget,
  received: WorkbenchRequest,
  runs: WorkflowRunStarter | null
): Promise<WorkbenchLaunchOutcome> {
  if (runs === null) {
    const blocker = launchBlocker(
      'launch_refused',
      'autopilot_primary_session_not_configured',
      'Workflow runs are not available in this session.'
    )
    return blocked(target, received, blocker, null)
  }
  const input = startInput(target, received)
  if ('reason' in input) {
    return blocked(target, received, input, null)
  }
  // Why first: a cancel that already won leaves a stale revision here, so nothing is started.
  const launching = advance(target, received, { to: 'LAUNCHING' })
  let started: StartWorkflowRunResult
  try {
    started = await runs.startWorkflowRun(input)
  } catch (error) {
    started = thrownStart(target.owner, received.requestId, error)
  }
  if (!started.ok) {
    return blocked(target, launching, started.blocker, started.run?.runId ?? null)
  }
  const launched = advance(target, launching, { to: 'LAUNCHED', workflowRunId: started.run.runId })
  return { kind: 'launched', request: launched, runId: started.run.runId }
}

/**
 * The door's launch step (D-016 section 1.3): RECEIVED, LAUNCHING, then LAUNCHED or LAUNCH_BLOCKED.
 * It never rejects: a failure it cannot record is logged by code and left to startup reconciliation.
 */
export async function launchWorkbenchRequest(
  target: WorkbenchLaunchTarget,
  received: WorkbenchRequest,
  runs: WorkflowRunStarter | null
): Promise<WorkbenchLaunchOutcome> {
  try {
    return await launchSteps(target, received, runs)
  } catch (error) {
    const code = errorCodeOf(error)
    console.warn(`[workbench-intake] launch outcome not recorded: ${code}`)
    return { kind: 'not_launched', code }
  }
}

/**
 * Starts the launch on the next turn, so the caller (the desktop RPC or the dot service, which links
 * its own record first) has the receipt before anything runs. One launch per request at a time.
 */
export function scheduleWorkbenchLaunch(
  target: WorkbenchLaunchTarget,
  received: WorkbenchRequest
): void {
  const { requestId } = received
  if (launches.has(requestId)) {
    return
  }
  const launch = new Promise<void>((resolve) => setImmediate(resolve)).then(() =>
    launchWorkbenchRequest(target, received, getPrimarySessionRuntime())
  )
  launches.set(requestId, launch)
  void launch.then(() => launches.delete(requestId))
}

/** Resolves once the request's launch in this process has settled; null when none is in flight. */
export function waitForWorkbenchLaunch(requestId: string): Promise<WorkbenchLaunchOutcome | null> {
  return launches.get(requestId) ?? Promise.resolve(null)
}

export function isWorkbenchLaunchInFlight(requestId: string): boolean {
  return launches.has(requestId)
}

/** Waits for every launch in flight; for will-quit before the database closes, and for tests. */
export async function settleWorkbenchLaunches(): Promise<void> {
  while (launches.size > 0) {
    await Promise.all(launches.values())
  }
}

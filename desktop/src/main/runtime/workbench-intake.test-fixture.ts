// FIXTURE_ONLY: a fake primary-session runtime over the real run and owner stores. Nothing spawns,
// no terminal exists, and every id, model and hash is synthetic.
import { vi } from 'vitest'
import type { OrchestrationDb } from './orchestration/db'
import { getPrimarySessionStore } from './orchestration/db/primary-session-store'
import { getWorkflowRunStore, type WorkflowRunRecord } from './orchestration/db/workflow-run-store'
import { launchBlocker } from './workflow-run/primary-session-ports'
import type { PrimarySessionRuntime } from './workflow-run/primary-session-runtime'
import type { PrimarySessionStopResult } from './workflow-run/primary-session-stop'
import type {
  StartWorkflowRunInput,
  StartWorkflowRunResult
} from './workflow-run/workflow-run-service'
import { moveOwner, moveWorkflowRun } from './workflow-run/primary-session-moves'

export const FIXTURE_TABLE_SHA256 = 'b'.repeat(64)
const FIXTURE_TIME = '2026-10-05T00:00:00.000Z'

export type FakeLaunchMode =
  | 'launched'
  | 'route_unavailable'
  | 'unverifiable_after_spawn'
  | 'throws_before_run'
  | 'throws_after_run'

export type FakeRunsOptions = {
  readonly mode?: FakeLaunchMode
  /** Held until the test releases it, to observe a request while it is LAUNCHING. */
  readonly gate?: Promise<void>
  readonly stop?: PrimarySessionStopResult['outcome'] | 'refused_starting'
}

let runCounter = 0

/** Creates the app run record and its running owner, the way a real launch leaves them. */
export function seedLaunchedRun(
  owner: OrchestrationDb,
  input: StartWorkflowRunInput,
  status: 'active' | 'unverifiable' = 'active'
): WorkflowRunRecord {
  runCounter += 1
  const runId = `run_fixture${String(runCounter).padStart(3, '0')}`
  getWorkflowRunStore(owner).create({
    runId,
    requestId: input.requestId,
    workspaceId: input.workspaceId,
    workspaceBinding: input.workspaceBinding,
    requestedAccess: input.requestedAccess,
    routingTableVersion: 1,
    routingTableSha256: FIXTURE_TABLE_SHA256,
    coordinatorAgent: 'claude',
    coordinatorModel: 'claude-opus-5-5',
    coordinatorEffort: 'max',
    timestamp: FIXTURE_TIME
  })
  const sessions = getPrimarySessionStore(owner)
  const session = sessions.insertStarting({
    runId,
    launchOperationId: `operation_${runId}`,
    permissionMode: 'manual',
    requestedModel: 'claude-opus-5-5',
    requestedEffort: 'max',
    timestamp: FIXTURE_TIME
  })
  sessions.markRunning(session.ownerId, {
    terminalHandle: `terminal_${runId}`,
    paneKey: `pane_${runId}:1`,
    processIncarnation: `incarnation_${runId}`,
    launchTokenSha256: 'a'.repeat(64),
    launchLedger: 'orca',
    receipt: { mode: 'terminal' },
    timestamp: FIXTURE_TIME
  })
  const reason = status === 'active' ? null : 'launch_outcome_unknown'
  const moved = moveWorkflowRun(owner, runId, status, reason, FIXTURE_TIME)
  if (!moved) {
    throw new Error('fixture run missing')
  }
  return moved
}

async function startFake(
  owner: OrchestrationDb,
  options: FakeRunsOptions,
  input: StartWorkflowRunInput
): Promise<StartWorkflowRunResult> {
  await options.gate
  const existing = getWorkflowRunStore(owner).getByRequestId(input.requestId)
  if (existing) {
    return { ok: true, duplicate: true, run: existing, owner: null }
  }
  switch (options.mode ?? 'launched') {
    case 'route_unavailable':
      return {
        ok: false,
        blocker: launchBlocker(
          'coordinator_route_unavailable',
          'autopilot_coordinator_route_unavailable',
          'The coordinator route is unavailable: model_unobserved.'
        ),
        run: null,
        owner: null
      }
    case 'unverifiable_after_spawn': {
      const run = seedLaunchedRun(owner, input, 'unverifiable')
      return {
        ok: false,
        blocker: launchBlocker('launch_unverifiable', 'autopilot_launch_outcome_unknown', 'x.'),
        run,
        owner: getPrimarySessionStore(owner).latestForRun(run.runId)
      }
    }
    case 'throws_before_run':
      throw new Error('fixture launcher failure')
    case 'throws_after_run':
      seedLaunchedRun(owner, input, 'unverifiable')
      throw new Error('fixture launcher failure')
    default: {
      const run = seedLaunchedRun(owner, input)
      return {
        ok: true,
        duplicate: false,
        run,
        owner: getPrimarySessionStore(owner).latestForRun(run.runId)
      }
    }
  }
}

function stopFake(owner: OrchestrationDb, options: FakeRunsOptions) {
  return async (runId: string, reason: string): Promise<PrimarySessionStopResult> => {
    const live = getPrimarySessionStore(owner).findLiveByRun(runId)
    if (!live) {
      return { outcome: 'refused', code: 'autopilot_owner_not_live', owner: null }
    }
    if (options.stop === 'refused_starting') {
      return { outcome: 'refused', code: 'autopilot_owner_starting', owner: live }
    }
    if (options.stop === 'stop_unconfirmed') {
      const unconfirmed = moveOwner(
        owner,
        live.ownerId,
        'unverifiable',
        'stop_unconfirmed',
        FIXTURE_TIME
      )
      return { outcome: 'stop_unconfirmed', owner: unconfirmed ?? live }
    }
    moveOwner(owner, live.ownerId, 'stopping', null, FIXTURE_TIME)
    const stopped = moveOwner(owner, live.ownerId, 'stopped', reason, FIXTURE_TIME)
    return { outcome: 'stopped', owner: stopped ?? live }
  }
}

/** A PrimarySessionRuntime whose start and stop act on the real stores; the rest are inert spies. */
export function createFakePrimarySessionRuntime(
  owner: OrchestrationDb,
  options: FakeRunsOptions = {}
) {
  const startWorkflowRun = vi.fn((input: StartWorkflowRunInput) => startFake(owner, options, input))
  const stopPrimarySession = vi.fn(stopFake(owner, options))
  const runtime: PrimarySessionRuntime = {
    startWorkflowRun,
    stopPrimarySession,
    readPrimarySessionStatus: vi.fn(async () => null),
    deliverRunMessage: vi.fn(async () => ({
      outcome: 'queued' as const,
      reason: 'agent_busy',
      messageId: 'message_fixture01',
      state: 'received' as const,
      duplicate: false
    })),
    readRunOrigin: vi.fn(() => ({ found: false as const })),
    notifyPrimaryStatusChanged: vi.fn(),
    reconcile: vi.fn(async () => {
      throw new Error('not used')
    }),
    dispose: vi.fn()
  }
  return { runtime, startWorkflowRun, stopPrimarySession }
}

/** A gate the test opens by hand. */
export function manualGate(): { readonly gate: Promise<void>; open(): void } {
  let open: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  return { gate, open: () => open() }
}

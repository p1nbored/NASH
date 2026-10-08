// FIXTURE_ONLY: every id, hash, path and model below is synthetic and describes no real run.
import { APP_ATTEMPT_STAGES } from './app-attempt-stages'
import { fixtureTime } from './autopilot-runtime.test-fixture'
import { transitionLifecycleWithDb } from './lifecycle-transition'
import { seedTask, type AppRunHarness } from './app-attempt.test-fixture'
import { getTaskClassificationStore } from './task-classification-store'
import { getTaskRouteStore, type TaskRouteInput } from './task-route-store'
import type { TaskSpecInput } from './task-spec-store'

export function routeInput(
  classificationId: string,
  overrides: Partial<TaskRouteInput> = {}
): TaskRouteInput {
  return {
    classificationId,
    routingTableVersion: 1,
    routingTableSha256: 'c'.repeat(64),
    target: 'claude_subagent',
    model: 'claude-sonnet-5-5',
    policyLevel: 'max',
    cliSetting: null,
    status: 'available',
    reasons: [],
    availability: { cli: 'present', auth: 'ok' },
    timestamp: fixtureTime(3),
    ...overrides
  }
}

/** A task with its TaskSpec, one classification and one route, ready to be started. */
export function seedRoutedTask(
  harness: AppRunHarness,
  options: { deps?: string[]; route?: Partial<TaskRouteInput>; spec?: Partial<TaskSpecInput> } = {}
): { taskId: string; classificationId: string; routeId: string } {
  const { taskId } = seedTask(harness, { deps: options.deps, spec: options.spec })
  const classification = getTaskClassificationStore(harness.owner).record({
    taskId,
    attempt: 1,
    outcome: 'classified',
    detail: null,
    needsDelegation: true,
    taskType: 'software_engineering',
    answers: null,
    bundleSha256: 'd'.repeat(64),
    taxonomyVersion: 2,
    profileSha256: 'e'.repeat(64),
    classifierModel: 'fixture-classifier',
    rawResponseId: null,
    spendReservationId: null,
    timestamp: fixtureTime(2)
  })
  const route = getTaskRouteStore(harness.owner).record(
    routeInput(classification.classificationId, options.route)
  )
  return { taskId, classificationId: classification.classificationId, routeId: route.routeId }
}

/** Orca's starting Dispatch for an in-session attempt. */
export function startOrcaDispatch(
  harness: AppRunHarness,
  taskId: string,
  routeId: string,
  options: { retryOf?: string } = {}
): { dispatchId: string } {
  const started = harness.owner.createStartingWorkerDispatch({
    taskId,
    startOptions: { executor: 'in_session', route_id: routeId },
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    retryOf: options.retryOf
  })
  return { dispatchId: started.dispatch.id }
}

/** An in-session attempt recorded through Orca's existing Dispatch. */
export function seedStartedAttempt(
  harness: AppRunHarness,
  taskId: string,
  routeId: string,
  options: { retryOf?: string } = {}
): { dispatchId: string } {
  const { dispatchId } = startOrcaDispatch(harness, taskId, routeId, options)
  return { dispatchId }
}

/** Puts an attempt in the state a recorded executor claim leaves it in, by Orca's own lifecycle writes. */
export function forceAwaitingValidation(harness: AppRunHarness, dispatchId: string): void {
  const db = harness.owner.db
  const dispatch = harness.owner.getDispatchContextById(dispatchId)
  if (!dispatch) {
    throw new Error(`fixture dispatch ${dispatchId} is missing`)
  }
  db.exec('BEGIN IMMEDIATE')
  transitionLifecycleWithDb(db, {
    entity: 'dispatch',
    id: dispatchId,
    from: 'pending',
    to: 'dispatched'
  })
  transitionLifecycleWithDb(db, {
    entity: 'worker',
    id: dispatchId,
    from: 'starting',
    to: 'ready',
    projection: { stage: APP_ATTEMPT_STAGES.validationPending }
  })
  transitionLifecycleWithDb(db, {
    entity: 'task',
    id: dispatch.task_id,
    from: 'dispatched',
    to: 'blocked'
  })
  db.exec('COMMIT')
}

// FIXTURE_ONLY: ids, hashes, panes and models are synthetic and describe no real run or terminal.
import type { OrchestrationDb } from '../orchestration/db'
import {
  FIXTURE_HASH_A,
  FIXTURE_HASH_B,
  fixtureTime,
  insertRawTaskSpec
} from '../orchestration/db/autopilot-runtime.test-fixture'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { ensureWorkbenchRequestSchema } from '../orchestration/db/workbench-request-schema'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import type { WorkflowRunStatus } from '../orchestration/db/workflow-run-transition'

export const PRIMARY_PANE_KEY = 'tab_primary:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const OTHER_PANE_KEY = 'tab_other:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
/** The same pane after its tab half was reminted: only the leaf id still matches. */
export const PRIMARY_PANE_KEY_REMINTED = 'tab_moved:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type Step = { to: WorkflowRunStatus; reason: string | null }
const PATH_TO_STATUS: Record<WorkflowRunStatus, readonly Step[]> = {
  launching: [],
  active: [{ to: 'active', reason: null }],
  completing: [
    { to: 'active', reason: null },
    { to: 'completing', reason: null }
  ],
  completed: [
    { to: 'active', reason: null },
    { to: 'completing', reason: null },
    { to: 'completed', reason: null }
  ],
  failed: [{ to: 'failed', reason: 'launch_failed' }],
  canceled: [{ to: 'canceled', reason: 'user_canceled' }],
  unverifiable: [{ to: 'unverifiable', reason: 'owner_unverifiable' }]
}

export type AppRunSeed = {
  /** The Orca run id the app records as its own; the Orca run must already exist. */
  runId: string
  status?: WorkflowRunStatus
  /** The owner row: absent, still starting (no pane yet), running in `paneKey`, or exited. */
  primary?: 'none' | 'starting' | 'running' | 'exited'
  paneKey?: string
}

function insertOwner(db: OrchestrationDb, seed: AppRunSeed): { ownerId: string } {
  const sessions = getPrimarySessionStore(db)
  const session = sessions.insertStarting({
    runId: seed.runId,
    launchOperationId: `operation_${seed.runId}`,
    permissionMode: 'manual',
    requestedModel: 'claude-opus-5-5',
    requestedEffort: 'max',
    timestamp: fixtureTime()
  })
  if (seed.primary === 'starting') {
    return { ownerId: session.ownerId }
  }
  sessions.markRunning(session.ownerId, {
    terminalHandle: `terminal_${seed.runId}`,
    paneKey: seed.paneKey ?? PRIMARY_PANE_KEY,
    processIncarnation: `incarnation_${seed.runId}`,
    launchTokenSha256: FIXTURE_HASH_A,
    launchLedger: 'orca',
    receipt: { mode: 'terminal' },
    timestamp: fixtureTime(1)
  })
  if (seed.primary === 'exited') {
    sessions.transition({
      ownerId: session.ownerId,
      from: 'running',
      to: 'exited',
      reason: 'process_exited',
      timestamp: fixtureTime(2)
    })
  }
  return { ownerId: session.ownerId }
}

/** Gives an existing Orca run a workflow_runs row (and optionally an owner), the app-run marker. */
export function markRunAsAppRun(db: OrchestrationDb, seed: AppRunSeed): void {
  const runs = getWorkflowRunStore(db)
  runs.create({
    runId: seed.runId,
    requestId: `request_${seed.runId}`,
    workspaceId: 'fixture-repo::/fixture/repo',
    workspaceBinding: FIXTURE_HASH_A,
    requestedAccess: 'read_only',
    deliverableLanguage: null,
    routingTableVersion: 1,
    routingTableSha256: FIXTURE_HASH_B,
    coordinatorModel: 'claude-opus-5-5',
    coordinatorEffort: 'max',
    timestamp: fixtureTime()
  })
  if ((seed.primary ?? 'running') !== 'none') {
    insertOwner(db, { ...seed, primary: seed.primary ?? 'running' })
  }
  for (const step of PATH_TO_STATUS[seed.status ?? 'active']) {
    const current = runs.get(seed.runId)
    if (!current) {
      throw new Error('fixture run vanished')
    }
    runs.transition({
      runId: seed.runId,
      from: current.status,
      to: step.to,
      expectedRevision: current.revision,
      reason: step.reason,
      timestamp: fixtureTime(10)
    })
  }
}

/** The side row an app task has; validation and executor rows hang off it. */
export function addAppTaskSpec(db: OrchestrationDb, taskId: string, runId: string): void {
  insertRawTaskSpec(db.db, taskId, runId)
}

let validationCounter = 0

export function addValidationRow(
  db: OrchestrationDb,
  taskId: string,
  verdict: 'pending' | 'pass' | 'fail' | 'inconclusive',
  waiver: 'desktop_user' | 'dot' | null = null
): void {
  validationCounter += 1
  db.db
    .prepare(
      `INSERT INTO task_validations (validation_id, task_id, dispatch_id, policy, criteria_sha256, verdict,
        checks, validator_id, evidence_refs, waiver, waived_at, created_at, updated_at)
        VALUES (?, ?, ?, 'machine_checks', ?, ?, '[]', 'validator_fixture', '[]', ?, ?, ?, ?)`
    )
    .run(
      `validation_fixture_${validationCounter}`,
      taskId,
      `dispatch_fixture_${validationCounter}`,
      FIXTURE_HASH_A,
      verdict,
      waiver,
      waiver ? fixtureTime() : null,
      fixtureTime(),
      fixtureTime()
    )
}

/** The classification, route and executor row a Codex or agy attempt has once task-start ran. */
export function addExecutorAttempt(
  db: OrchestrationDb,
  attempt: { dispatchId: string; runId: string; taskId: string; kind: 'codex_cli' | 'agy_cli' }
): void {
  const { dispatchId, runId, taskId, kind } = attempt
  // Why: task_classifications points at the spend tables, which the Workbench family owns.
  ensureWorkbenchRequestSchema(db.db)
  db.db
    .prepare(
      `INSERT INTO task_classifications (classification_id, task_id, attempt, outcome, needs_delegation, task_type, created_at)
        VALUES (?, ?, 1, 'classified', 1, 'general_research_analysis', ?)`
    )
    .run(`classification_${taskId}`, taskId, fixtureTime())
  db.db
    .prepare(
      `INSERT INTO task_routes (route_id, classification_id, routing_table_version, routing_table_sha256,
        target, model, policy_level, status, reasons, created_at)
        VALUES (?, ?, 1, ?, ?, 'gpt-6.1-sol', 'max', 'available', '[]', ?)`
    )
    .run(`route_${taskId}`, `classification_${taskId}`, FIXTURE_HASH_B, kind, fixtureTime())
  db.db
    .prepare(
      `INSERT INTO executor_processes (dispatch_id, run_id, task_id, executor_kind, route_id, state,
        run_directory, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`
    )
    .run(
      dispatchId,
      runId,
      taskId,
      kind,
      `route_${taskId}`,
      `${runId}/${dispatchId}`,
      fixtureTime()
    )
}

import { randomUUID } from 'node:crypto'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { PRIMARY_SESSION_LIVE_STATES, sqlStringList } from './autopilot-run-schema-definition'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import {
  AutopilotLimitSchema,
  ReasonCodeSchema,
  changedRowCount,
  parseAutopilotInput,
  runAutopilotWrite
} from './autopilot-store-input'
import { runLifecycleWriteTransaction } from './lifecycle-write-transaction-runner'
import {
  PRIMARY_SESSION_COLUMNS as COLUMNS,
  PRIMARY_SESSION_ENDED_STATES,
  PRIMARY_SESSION_STATES_WITH_REASON,
  PRIMARY_SESSION_TRANSITIONS,
  PrimarySessionInsertSchema,
  PrimarySessionRunningSchema,
  PrimarySessionTransitionSchema,
  requirePrimarySessionPermissionMode,
  toPrimarySessionRecord as toRecord,
  type PrimarySessionInsert,
  type PrimarySessionRecord,
  type PrimarySessionRunning,
  type PrimarySessionTransition
} from './primary-session-record'

export {
  PRIMARY_SESSION_TRANSITIONS,
  type PrimarySessionInsert,
  type PrimarySessionPermissionMode,
  type PrimarySessionRecord,
  type PrimarySessionRunning,
  type PrimarySessionState,
  type PrimarySessionTransition
} from './primary-session-record'

const LIVE_SQL = sqlStringList(PRIMARY_SESSION_LIVE_STATES)
const RUN_STATUSES_THAT_MAY_LAUNCH: ReadonlySet<string> = new Set(['launching', 'active'])

function conflict(message: string): OrchestrationError {
  return new OrchestrationError('autopilot_owner_conflict', message)
}

const stores = new WeakMap<OrchestrationDb, PrimarySessionStore>()

export function getPrimarySessionStore(owner: OrchestrationDb): PrimarySessionStore {
  let store = stores.get(owner)
  if (!store) {
    store = new PrimarySessionStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/** The owner record of a run's visible primary session: at most one live owner per run, and per pane. */
export class PrimarySessionStore {
  constructor(private readonly db: Database.Database) {
    ensureAutopilotRuntimeSchema(db)
  }

  get(ownerId: string): PrimarySessionRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM primary_sessions WHERE owner_id = ?`)
      .get(ownerId)
    return row ? toRecord(row) : null
  }

  findLiveByRun(runId: string): PrimarySessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM primary_sessions WHERE run_id = ? AND state IN (${LIVE_SQL})`
      )
      .get(runId)
    return row ? toRecord(row) : null
  }

  latestForRun(runId: string): PrimarySessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM primary_sessions WHERE run_id = ? ORDER BY generation DESC LIMIT 1`
      )
      .get(runId)
    return row ? toRecord(row) : null
  }

  /** The caller-attestation lookup: the live owner whose pane and process incarnation both match. */
  findLiveByPane(paneKey: string, processIncarnation: string): PrimarySessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM primary_sessions WHERE pane_key = ? AND process_incarnation = ? AND state IN (${LIVE_SQL})`
      )
      .get(paneKey, processIncarnation)
    return row ? toRecord(row) : null
  }

  /** Every live owner, oldest first, for restart reconciliation. */
  listLive(limit: number): PrimarySessionRecord[] {
    const bound = parseAutopilotInput(AutopilotLimitSchema, limit, 'owner list limit')
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM primary_sessions WHERE state IN (${LIVE_SQL}) ORDER BY sequence LIMIT ?`
      )
      .all(bound)
      .map(toRecord)
  }

  /** Records the owner before the launch, so a crash during it leaves evidence to reconcile. */
  insertStarting(input: PrimarySessionInsert): PrimarySessionRecord {
    const permissionMode = requirePrimarySessionPermissionMode(input.permissionMode)
    const params = parseAutopilotInput(PrimarySessionInsertSchema, input, 'primary session')
    const ownerId = `owner_${randomUUID()}`
    return runAutopilotWrite(this.db, 'autopilot_owner', () => {
      this.requireLaunchableRun(params.runId)
      if (this.findLiveByRun(params.runId)) {
        throw new OrchestrationError(
          'autopilot_owner_exists',
          'The run already has a live primary session.'
        )
      }
      const used = this.db
        .prepare('SELECT 1 AS used FROM primary_sessions WHERE launch_operation_id = ?')
        .get(params.launchOperationId)
      if (used) {
        throw conflict('That launch operation id was already used.')
      }
      const next = this.db
        .prepare(
          'SELECT COALESCE(MAX(generation), 0) + 1 AS next FROM primary_sessions WHERE run_id = ?'
        )
        .get(params.runId)
      this.db
        .prepare(
          `INSERT INTO primary_sessions (owner_id, run_id, generation, launch_operation_id, permission_mode,
            requested_model, requested_effort, state, started_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?)`
        )
        .run(
          ownerId,
          params.runId,
          Number(next?.next),
          params.launchOperationId,
          permissionMode,
          params.requestedModel,
          params.requestedEffort,
          params.timestamp,
          params.timestamp
        )
      return this.requireOwner(ownerId)
    })
  }

  /** The only way from starting to running: the launch result supplies the pane identity. */
  markRunning(ownerId: string, input: PrimarySessionRunning): PrimarySessionRecord {
    const params = parseAutopilotInput(
      PrimarySessionRunningSchema,
      input,
      'primary session identity'
    )
    return runAutopilotWrite(this.db, 'autopilot_owner', () => {
      const current = this.requireOwner(ownerId)
      if (current.state !== 'starting') {
        throw conflict('The owner is no longer starting.')
      }
      const sharesPane = this.db
        .prepare(
          `SELECT 1 AS shared FROM primary_sessions WHERE pane_key = ? AND process_incarnation = ?
            AND state IN (${LIVE_SQL}) AND owner_id <> ?`
        )
        .get(params.paneKey, params.processIncarnation, ownerId)
      if (sharesPane) {
        throw conflict('That pane is already the live primary session of another run.')
      }
      const result = this.db
        .prepare(
          `UPDATE primary_sessions SET state = 'running', terminal_handle = ?, pane_key = ?,
            process_incarnation = ?, launch_token_sha256 = ?, launch_ledger = ?, receipt = ?,
            updated_at = ? WHERE owner_id = ? AND state = 'starting'`
        )
        .run(
          params.terminalHandle,
          params.paneKey,
          params.processIncarnation,
          params.launchTokenSha256,
          params.launchLedger,
          JSON.stringify(params.receipt),
          params.timestamp,
          ownerId
        )
      if (changedRowCount(result) !== 1) {
        throw conflict('The owner changed. Nothing was written.')
      }
      return this.requireOwner(ownerId)
    })
  }

  /** Moves along the frozen edge list; the stated from-state is a compare-and-set. */
  transition(input: PrimarySessionTransition): PrimarySessionRecord {
    const params = parseAutopilotInput(PrimarySessionTransitionSchema, input, 'owner transition')
    const { from, to, reason } = params
    if (!PRIMARY_SESSION_TRANSITIONS[from].includes(to)) {
      throw new OrchestrationError(
        'autopilot_invalid_transition',
        `Owner cannot move from ${from} to ${to}.`
      )
    }
    if (from === 'starting' && to === 'running') {
      throw new OrchestrationError(
        'autopilot_identity_required',
        'Use markRunning to supply the pane identity.'
      )
    }
    const needsReason = PRIMARY_SESSION_STATES_WITH_REASON.has(to)
    const reasonFits = needsReason
      ? reason !== null && ReasonCodeSchema.safeParse(reason).success
      : reason === null
    if (!reasonFits) {
      throw new OrchestrationError(
        'autopilot_invalid_reason',
        needsReason
          ? `An owner moving to ${to} needs a reason code.`
          : `An owner moving to ${to} takes no reason.`
      )
    }
    return runLifecycleWriteTransaction(this.db, 'autopilot_owner', () => {
      const current = this.requireOwner(params.ownerId)
      if (current.state !== from) {
        throw conflict('The owner changed. Nothing was written.')
      }
      if ((to === 'running' || to === 'stopping') && current.paneKey === null) {
        throw new OrchestrationError(
          'autopilot_identity_required',
          'The owner has no pane identity to verify or stop.'
        )
      }
      const result = this.db
        .prepare(
          `UPDATE primary_sessions SET state = ?, end_reason = ?, updated_at = ?, ended_at = ?
            WHERE owner_id = ? AND state = ?`
        )
        .run(
          to,
          reason,
          params.timestamp,
          PRIMARY_SESSION_ENDED_STATES.has(to) ? params.timestamp : null,
          params.ownerId,
          from
        )
      if (changedRowCount(result) !== 1) {
        throw conflict('The owner changed. Nothing was written.')
      }
      return this.requireOwner(params.ownerId)
    })
  }

  private requireLaunchableRun(runId: string): void {
    const run = this.db.prepare('SELECT status FROM workflow_runs WHERE run_id = ?').get(runId)
    if (!run) {
      throw new OrchestrationError('autopilot_run_not_found', 'The run was not found.')
    }
    if (!RUN_STATUSES_THAT_MAY_LAUNCH.has(String(run.status))) {
      throw new OrchestrationError(
        'autopilot_run_not_live',
        'A primary session can only start for a launching or active run.'
      )
    }
  }

  private requireOwner(ownerId: string): PrimarySessionRecord {
    const owner = this.get(ownerId)
    if (!owner) {
      throw new OrchestrationError('autopilot_owner_not_found', 'The owner was not found.')
    }
    return owner
  }
}

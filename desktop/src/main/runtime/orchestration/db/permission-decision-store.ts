import { randomUUID } from 'node:crypto'
import type Database from '../../../sqlite/sync-database'
import { maskSecretLikeText } from '../../../agent-exec-shared/secret-shapes'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import {
  UtcTimestampSchema,
  changedRowCount,
  parseAutopilotInput,
  runAutopilotWrite
} from './autopilot-store-input'
import {
  PERMISSION_DECISION_COLUMNS as COLUMNS,
  PERMISSION_PENDING_LIMIT_PER_OWNER,
  PermissionAnswerSchema,
  PermissionDecisionCreateSchema,
  PermissionDecisionListSchema,
  PermissionTerminalAnswerSchema,
  toPermissionDecisionRecord as toRecord,
  type PermissionAnswerInput,
  type PermissionAnswerResult,
  type PermissionDecisionCreate,
  type PermissionDecisionRecord,
  type PermissionDecisionStatus,
  type PermissionTerminalAnswerInput
} from './permission-decision-record'

export {
  PERMISSION_DECISION_MAX_WAIT_MS,
  PERMISSION_PENDING_LIMIT_PER_OWNER,
  type PermissionAnswerInput,
  type PermissionAnswerResult,
  type PermissionDecisionCreate,
  type PermissionDecisionRecord,
  type PermissionDecisionStatus,
  type PermissionTerminalAnswerInput
} from './permission-decision-record'

const LIVE_OWNER_STATES: ReadonlySet<string> = new Set(['running', 'unverifiable'])
const LIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  'launching',
  'active',
  'completing',
  'unverifiable'
])

const stores = new WeakMap<OrchestrationDb, PermissionDecisionStore>()

export function getPermissionDecisionStore(owner: OrchestrationDb): PermissionDecisionStore {
  let store = stores.get(owner)
  if (!store) {
    store = new PermissionDecisionStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/** Prompts raised by a primary session or its subagents, answered by dot, the desktop or the terminal. */
export class PermissionDecisionStore {
  constructor(private readonly db: Database.Database) {
    ensureAutopilotRuntimeSchema(db)
  }

  get(decisionId: string): PermissionDecisionRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM permission_decisions WHERE decision_id = ?`)
      .get(decisionId)
    return row ? toRecord(row) : null
  }

  listForRun(
    runId: string,
    options: { statuses?: readonly PermissionDecisionStatus[]; limit: number }
  ): PermissionDecisionRecord[] {
    const { statuses, limit } = parseAutopilotInput(
      PermissionDecisionListSchema,
      options,
      'decision list'
    )
    if (statuses?.length === 0) {
      return []
    }
    const filter = statuses ? ` AND status IN (${statuses.map(() => '?').join(', ')})` : ''
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM permission_decisions WHERE run_id = ?${filter} ORDER BY sequence LIMIT ?`
      )
      .all(runId, ...(statuses ?? []), limit)
      .map(toRecord)
  }

  listPending(runId: string, limit: number): PermissionDecisionRecord[] {
    return this.listForRun(runId, { statuses: ['pending'], limit })
  }

  /** Opens a pending decision. The summary must already be redacted: an unmasked secret is refused, not masked. */
  create(input: PermissionDecisionCreate): PermissionDecisionRecord {
    const params = parseAutopilotInput(PermissionDecisionCreateSchema, input, 'permission decision')
    if (maskSecretLikeText(params.summary) !== params.summary) {
      throw new OrchestrationError(
        'autopilot_summary_unredacted',
        'The summary still holds a credential. Nothing was stored.'
      )
    }
    const decisionId = randomUUID()
    return runAutopilotWrite(this.db, 'autopilot_permission', () => {
      this.requireLiveOwner(params.runId, params.ownerId)
      // Why: an overdue prompt no longer holds a slot, but stays pending so its open terminal dialog can still close it.
      const pending = this.db
        .prepare(
          "SELECT count(*) AS n FROM permission_decisions WHERE owner_id = ? AND status = 'pending' AND deadline_at > ?"
        )
        .get(params.ownerId, params.timestamp)
      if (Number(pending?.n) >= PERMISSION_PENDING_LIMIT_PER_OWNER) {
        throw new OrchestrationError(
          'autopilot_permission_capacity_exceeded',
          'Too many permission prompts are waiting for this session.'
        )
      }
      this.db
        .prepare(
          `INSERT INTO permission_decisions (decision_id, run_id, owner_id, agent_id, tool_name, summary,
            request_sha256, status, created_at, deadline_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .run(
          decisionId,
          params.runId,
          params.ownerId,
          params.agentId,
          params.toolName,
          params.summary,
          params.requestSha256,
          params.timestamp,
          params.deadlineAt
        )
      return this.requireDecision(decisionId)
    })
  }

  /** Compare-and-set on pending: the first answer wins and a late one is reported as already_decided. */
  answer(input: PermissionAnswerInput): PermissionAnswerResult {
    const params = parseAutopilotInput(PermissionAnswerSchema, input, 'permission answer')
    const decided = this.db
      .prepare(
        `UPDATE permission_decisions SET status = ?, decided_by = ?, decided_at = ?
          WHERE decision_id = ? AND status = 'pending' AND deadline_at > ?`
      )
      .run(params.decision, params.decidedBy, params.timestamp, params.decisionId, params.timestamp)
    if (changedRowCount(decided) === 1) {
      return { outcome: 'decided', record: this.requireDecision(params.decisionId) }
    }
    // Why: the hook stopped waiting at the deadline, so an answer after it can no longer take effect.
    this.db
      .prepare(
        `UPDATE permission_decisions SET status = 'expired', decided_at = ?
          WHERE decision_id = ? AND status = 'pending' AND deadline_at <= ?`
      )
      .run(params.timestamp, params.decisionId, params.timestamp)
    return this.settledResult(params.decisionId)
  }

  /** The agent left its permission state with no answer from us: the user answered in the terminal. */
  markAnsweredInTerminal(input: PermissionTerminalAnswerInput): PermissionAnswerResult {
    const params = parseAutopilotInput(PermissionTerminalAnswerSchema, input, 'terminal answer')
    const decided = this.db
      .prepare(
        `UPDATE permission_decisions SET status = 'answered_in_terminal', decided_by = 'terminal', decided_at = ?
          WHERE decision_id = ? AND status = 'pending'`
      )
      .run(params.timestamp, params.decisionId)
    if (changedRowCount(decided) === 1) {
      return { outcome: 'decided', record: this.requireDecision(params.decisionId) }
    }
    return this.settledResult(params.decisionId)
  }

  /** Closes one pending decision whose deadline passed; false when it was not pending or not yet due. */
  expire(decisionId: string, timestamp: string): boolean {
    const now = parseAutopilotInput(UtcTimestampSchema, timestamp, 'timestamp')
    const expired = this.db
      .prepare(
        `UPDATE permission_decisions SET status = 'expired', decided_at = ?
          WHERE decision_id = ? AND status = 'pending' AND deadline_at <= ?`
      )
      .run(now, decisionId, now)
    return changedRowCount(expired) === 1
  }

  private settledResult(decisionId: string): PermissionAnswerResult {
    const record = this.get(decisionId)
    return record ? { outcome: 'already_decided', record } : { outcome: 'not_found' }
  }

  private requireDecision(decisionId: string): PermissionDecisionRecord {
    const record = this.get(decisionId)
    if (!record) {
      throw new OrchestrationError('autopilot_recovery_required', 'The decision row disappeared.')
    }
    return record
  }

  private requireLiveOwner(runId: string, ownerId: string): void {
    const row = this.db
      .prepare(
        `SELECT s.state AS state, r.status AS run_status FROM primary_sessions s
          JOIN workflow_runs r ON r.run_id = s.run_id WHERE s.owner_id = ? AND s.run_id = ?`
      )
      .get(ownerId, runId)
    if (!row) {
      throw new OrchestrationError(
        'autopilot_owner_not_found',
        'The owner was not found for this run.'
      )
    }
    if (
      !LIVE_OWNER_STATES.has(String(row.state)) ||
      !LIVE_RUN_STATUSES.has(String(row.run_status))
    ) {
      throw new OrchestrationError(
        'autopilot_owner_not_live',
        'Only a running session of an open run can raise a permission prompt.'
      )
    }
  }
}

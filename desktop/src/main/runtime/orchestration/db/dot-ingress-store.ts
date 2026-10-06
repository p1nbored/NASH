import { randomUUID } from 'node:crypto'
import type Database from '../../../sqlite/sync-database'
import {
  DOT_INGRESS_DATA_CLASS,
  DOT_INGRESS_SENDER_AUTH,
  DOT_INGRESS_SOURCE,
  type DotSubmissionFailure
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import { DotRequestIdSchema } from '../../../../shared/dot-ingress/dot-ingress-params'
import { WorkbenchRequestIdSchema } from '../../../../shared/workbench-request'
import type { OrchestrationDb } from './orchestration-db'
import { changedRowCount } from './autopilot-store-input'
import { requireOpenWorkspace, requireWithinLimits } from './dot-ingress-admission'
import { insertDotIngressEvent } from './dot-ingress-event-log'
import {
  DOT_INTAKE_COLUMNS,
  DOT_RECORD_COLUMNS,
  toDotIntakeHandle,
  toDotRequestRecord,
  type DotIntakeHandle,
  type DotRequestRecord
} from './dot-ingress-request-row'
import { ensureDotIngressSchema } from './dot-ingress-schema'
import { readDotWorkspace } from './dot-ingress-settings-store'
import { dotIngressError, parseDotInput, runDotWrite } from './dot-ingress-store-input'
import {
  DotCancelInputSchema,
  DotFailInputSchema,
  DotIngressSubmitInputSchema,
  DotLinkInputSchema,
  DotListInputSchema,
  DotRecoveryLimitSchema,
  countQuotedSpans,
  dotIngressRequestHash,
  requireStorableObjective,
  type DotIngressSubmitInput
} from './dot-ingress-request-inputs'

export type { DotIntakeHandle, DotRequestRecord } from './dot-ingress-request-row'
export type { DotIngressSubmitInput } from './dot-ingress-request-inputs'

const stores = new WeakMap<OrchestrationDb, DotIngressStore>()

export function getDotIngressStore(owner: OrchestrationDb): DotIngressStore {
  let store = stores.get(owner)
  if (!store) {
    store = new DotIngressStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/**
 * Intake receipts of dot submissions. A submission is stored as `received`, goes through the single
 * intake door under the dot principal, and is then linked to its Workbench request (`submitted`).
 * Nothing waits for the user: the user decided on 2026-10-05 that dot tasks need no confirmation.
 */
export class DotIngressStore {
  constructor(private readonly db: Database.Database) {
    ensureDotIngressSchema(db)
  }

  /**
   * Gates (interface on, workspace enabled for dot, caps), then records the submission. `intake` is
   * the handle for the door call and is non-null while the row is still `received`, so a replay after
   * a crash finishes the same intake instead of starting another.
   */
  submit(input: DotIngressSubmitInput): {
    record: DotRequestRecord
    duplicate: boolean
    intake: DotIntakeHandle | null
  } {
    const params = parseDotInput(DotIngressSubmitInputSchema, input, 'dot request')
    requireStorableObjective(params.objective)
    return runDotWrite(this.db, 'dot_ingress_submit', () => {
      requireOpenWorkspace(this.db, params)
      const hash = dotIngressRequestHash(params)
      const prior = this.db
        .prepare(
          'SELECT dot_request_id, workspace_ref, input_hash FROM dot_ingress_requests WHERE idempotency_key = ?'
        )
        .get(params.idempotencyKey)
      if (prior) {
        if (prior.input_hash !== hash || prior.workspace_ref !== params.workspaceRef) {
          throw dotIngressError('dot_idempotency_conflict')
        }
        const record = this.requireRecord(String(prior.dot_request_id))
        return { record, duplicate: true, intake: this.intakeFor(record) }
      }
      requireWithinLimits(this.db, params.timestamp)
      const dotRequestId = randomUUID()
      this.insert(params, dotRequestId, hash)
      const record = this.requireRecord(dotRequestId)
      this.requireObjectivePreserved(dotRequestId, params.objective)
      insertDotIngressEvent(this.db, {
        kind: 'request_received',
        dotRequestId,
        workspaceRef: params.workspaceRef,
        revision: record.revision,
        timestamp: params.timestamp
      })
      return { record, duplicate: false, intake: this.intakeFor(record) }
    })
  }

  get(dotRequestId: string): DotRequestRecord {
    return this.requireRecord(parseDotInput(DotRequestIdSchema, dotRequestId, 'request id'))
  }

  /** Newest first. */
  list(options: { limit: number; beforeSequence?: number }): {
    records: DotRequestRecord[]
    nextBeforeSequence: number | null
  } {
    const { limit, beforeSequence } = parseDotInput(DotListInputSchema, options, 'request list')
    const rows = this.db
      .prepare(
        `SELECT ${DOT_RECORD_COLUMNS} FROM dot_ingress_requests WHERE sequence < ? ORDER BY sequence DESC LIMIT ?`
      )
      .all(beforeSequence ?? Number.MAX_SAFE_INTEGER, limit + 1)
    const records = rows.slice(0, limit).map(toDotRequestRecord)
    return {
      records,
      nextBeforeSequence: rows.length > limit ? (records.at(-1)?.sequence ?? null) : null
    }
  }

  /** The Workbench request exists: link it. Repeating the same link is not an error. */
  linkSubmitted(input: { dotRequestId: string; workbenchRequestId: string; timestamp: string }): {
    record: DotRequestRecord
    changed: boolean
  } {
    const params = parseDotInput(DotLinkInputSchema, input, 'intake link')
    return runDotWrite(this.db, 'dot_ingress_link', () => {
      const current = this.requireRecord(params.dotRequestId)
      if (current.workbenchRequestId === params.workbenchRequestId) {
        return { record: current, changed: false }
      }
      const otherOwner = this.db
        .prepare('SELECT dot_request_id FROM dot_ingress_requests WHERE workbench_request_id = ?')
        .get(params.workbenchRequestId)
      if (current.state !== 'received' || otherOwner) {
        throw dotIngressError('dot_recovery_required')
      }
      const updated = this.db
        .prepare(
          `UPDATE dot_ingress_requests SET state = 'submitted', workbench_request_id = ?, revision = revision + 1,
            updated_at = ? WHERE dot_request_id = ? AND state = 'received'`
        )
        .run(params.workbenchRequestId, params.timestamp, params.dotRequestId)
      return this.afterTransition(updated, params, 'request_submitted')
    })
  }

  /** The door refused before creating a Workbench request: the row ends as failed with a coarse code. */
  markFailed(input: { dotRequestId: string; failure: DotSubmissionFailure; timestamp: string }): {
    record: DotRequestRecord
    changed: boolean
  } {
    const params = parseDotInput(DotFailInputSchema, input, 'intake failure')
    return runDotWrite(this.db, 'dot_ingress_fail', () => {
      const current = this.requireRecord(params.dotRequestId)
      if (current.state === 'failed' && current.failureCode === params.failure) {
        return { record: current, changed: false }
      }
      if (current.state !== 'received') {
        throw dotIngressError('dot_recovery_required')
      }
      const updated = this.db
        .prepare(
          `UPDATE dot_ingress_requests SET state = 'failed', failure_code = ?, revision = revision + 1,
            updated_at = ?, ended_at = ? WHERE dot_request_id = ? AND state = 'received'`
        )
        .run(params.failure, params.timestamp, params.timestamp, params.dotRequestId)
      return this.afterTransition(updated, params, 'request_failed')
    })
  }

  /**
   * Ends a submitted request. The caller stops the Workbench request and its run first; this row
   * only records the outcome and keeps the Workbench link. A received row cannot be canceled: its
   * intake call is still running.
   */
  cancel(input: { dotRequestId: string; timestamp: string }): {
    record: DotRequestRecord
    changed: boolean
  } {
    const params = parseDotInput(DotCancelInputSchema, input, 'cancel')
    return runDotWrite(this.db, 'dot_ingress_cancel', () => {
      const current = this.requireRecord(params.dotRequestId)
      if (current.state === 'canceled') {
        return { record: current, changed: false }
      }
      if (current.state !== 'submitted') {
        throw dotIngressError('dot_request_not_cancelable')
      }
      const updated = this.db
        .prepare(
          `UPDATE dot_ingress_requests SET state = 'canceled', revision = revision + 1, updated_at = ?, ended_at = ?
            WHERE dot_request_id = ? AND state = 'submitted'`
        )
        .run(params.timestamp, params.timestamp, params.dotRequestId)
      return this.afterTransition(updated, params, 'request_canceled')
    })
  }

  /** Rows whose intake never finished (the app stopped between recording and linking), oldest first. */
  listUnsubmitted(limit: number): DotIntakeHandle[] {
    const bound = parseDotInput(DotRecoveryLimitSchema, limit, 'recovery limit')
    return this.db
      .prepare(
        `SELECT ${DOT_INTAKE_COLUMNS} FROM dot_ingress_requests WHERE state = 'received' ORDER BY sequence LIMIT ?`
      )
      .all(bound)
      .map(toDotIntakeHandle)
  }

  /** The dot request a Workbench request came from, or null for a request of any other origin. */
  findByWorkbenchRequestId(workbenchRequestId: string): DotRequestRecord | null {
    const id = parseDotInput(WorkbenchRequestIdSchema, workbenchRequestId, 'Workbench request id')
    const row = this.db
      .prepare(
        `SELECT ${DOT_RECORD_COLUMNS} FROM dot_ingress_requests WHERE workbench_request_id = ?`
      )
      .get(id)
    return row ? toDotRequestRecord(row) : null
  }

  private insert(params: DotIngressSubmitInput, dotRequestId: string, hash: string): void {
    const workspace = readDotWorkspace(this.db, params.workspaceRef)
    if (!workspace) {
      throw dotIngressError('dot_recovery_required')
    }
    this.db
      .prepare(
        `INSERT INTO dot_ingress_requests (dot_request_id, workspace_ref, workspace_id, workspace_binding, source,
          sender_auth, data_class, idempotency_key, input_hash, objective, span_count, scan_rules, requested_access,
          deliverable_language, reply_correlation_id, client_name, client_version, state, revision,
          workbench_idempotency_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', 1, ?, ?, ?)`
      )
      .run(
        dotRequestId,
        params.workspaceRef,
        workspace.workspaceId,
        params.workspaceBinding,
        DOT_INGRESS_SOURCE,
        DOT_INGRESS_SENDER_AUTH,
        DOT_INGRESS_DATA_CLASS,
        params.idempotencyKey,
        hash,
        params.objective,
        countQuotedSpans(params.objective),
        JSON.stringify(params.scanRules),
        params.requestedAccess,
        params.deliverableLanguage,
        params.replyCorrelationId,
        params.client?.name ?? null,
        params.client?.version ?? null,
        randomUUID(),
        params.timestamp,
        params.timestamp
      )
  }

  private requireObjectivePreserved(dotRequestId: string, objective: string): void {
    const stored = this.db
      .prepare('SELECT objective FROM dot_ingress_requests WHERE dot_request_id = ?')
      .get(dotRequestId)
    if (stored?.objective !== objective) {
      throw dotIngressError('dot_recovery_required')
    }
  }

  private intakeFor(record: DotRequestRecord): DotIntakeHandle | null {
    if (record.state !== 'received') {
      return null
    }
    const row = this.db
      .prepare(`SELECT ${DOT_INTAKE_COLUMNS} FROM dot_ingress_requests WHERE dot_request_id = ?`)
      .get(record.dotRequestId)
    return row ? toDotIntakeHandle(row) : null
  }

  private requireRecord(dotRequestId: string): DotRequestRecord {
    const row = this.db
      .prepare(`SELECT ${DOT_RECORD_COLUMNS} FROM dot_ingress_requests WHERE dot_request_id = ?`)
      .get(dotRequestId)
    if (!row) {
      throw dotIngressError('dot_request_not_found')
    }
    return toDotRequestRecord(row)
  }

  private afterTransition(
    updated: { changes: number | bigint },
    params: { dotRequestId: string; timestamp: string },
    kind: 'request_submitted' | 'request_failed' | 'request_canceled'
  ): { record: DotRequestRecord; changed: boolean } {
    if (changedRowCount(updated) !== 1) {
      throw dotIngressError('dot_recovery_required')
    }
    const record = this.requireRecord(params.dotRequestId)
    insertDotIngressEvent(this.db, {
      kind,
      dotRequestId: record.dotRequestId,
      workspaceRef: record.workspaceRef,
      revision: record.revision,
      timestamp: params.timestamp
    })
    return { record, changed: true }
  }
}

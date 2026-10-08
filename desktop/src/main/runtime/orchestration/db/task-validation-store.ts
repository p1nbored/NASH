import { randomUUID } from 'node:crypto'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { APP_ATTEMPT_AWAITING_VALIDATION_STAGES } from './app-attempt-stages'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import {
  AutopilotLimitSchema,
  parseAutopilotInput,
  runAutopilotWrite
} from './autopilot-store-input'
import { computeCriteriaSha256, type TaskSpecRecord } from './task-spec-record'
import { getTaskSpecStore, type TaskSpecStore } from './task-spec-store'
import {
  SELECT_TASK_VALIDATION,
  TaskValidationOpenInputSchema,
  isSameUnderlyingModel,
  toTaskValidationRecord,
  type TaskValidationOpenInput,
  type TaskValidationRecord
} from './task-validation-record'

export { applyValidationVerdict, applyValidationWaiver } from './task-validation-transition'
export type {
  EvidenceRef,
  TaskValidationOpenInput,
  TaskValidationRecord,
  ValidationCheck,
  ValidationVerdictInput,
  ValidationWaiverInput
} from './task-validation-record'

const stores = new WeakMap<OrchestrationDb, TaskValidationStore>()

export function getTaskValidationStore(owner: OrchestrationDb): TaskValidationStore {
  let store = stores.get(owner)
  if (!store) {
    store = new TaskValidationStore(owner.db, getTaskSpecStore(owner))
    stores.set(owner, store)
  }
  return store
}

function refused(code: string, message: string): OrchestrationError {
  return new OrchestrationError(code, message)
}

/**
 * What the validators decided about an attempt's claim. A validation opens only on an attempt whose
 * executor claimed it was done, follows the TaskSpec's policy, and is written only through the
 * outcome path that also moves the Task, so no verdict can exist beside a different Task status.
 */
export class TaskValidationStore {
  constructor(
    private readonly db: Database.Database,
    private readonly specs: TaskSpecStore
  ) {
    ensureAutopilotRuntimeSchema(db)
  }

  get(validationId: string): TaskValidationRecord | null {
    const row = this.db
      .prepare(`${SELECT_TASK_VALIDATION} WHERE validation_id = ?`)
      .get(validationId)
    return row ? toTaskValidationRecord(row) : null
  }

  /** The validation of an attempt; one policy applies per TaskSpec, so there is one row. */
  getForDispatch(dispatchId: string): TaskValidationRecord | null {
    const row = this.db
      .prepare(`${SELECT_TASK_VALIDATION} WHERE dispatch_id = ? ORDER BY sequence DESC LIMIT 1`)
      .get(dispatchId)
    return row ? toTaskValidationRecord(row) : null
  }

  latestForTask(taskId: string): TaskValidationRecord | null {
    const row = this.db
      .prepare(`${SELECT_TASK_VALIDATION} WHERE task_id = ? ORDER BY sequence DESC LIMIT 1`)
      .get(taskId)
    return row ? toTaskValidationRecord(row) : null
  }

  listForTask(taskId: string, limit = 100): TaskValidationRecord[] {
    const bound = parseAutopilotInput(AutopilotLimitSchema, limit, 'validation list limit')
    return this.db
      .prepare(`${SELECT_TASK_VALIDATION} WHERE task_id = ? ORDER BY sequence LIMIT ?`)
      .all(taskId, bound)
      .map(toTaskValidationRecord)
  }

  /** True only while Orca still holds the task: a pass left behind by a reset is not a pass. */
  hasPassing(taskId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM task_validations v
          WHERE v.task_id = ? AND v.verdict = 'pass'
            AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = v.task_id)`
      )
      .get(taskId)
    return row !== undefined
  }

  /** Opens the pending validation of a claimed attempt; the same request again returns it. */
  open(input: TaskValidationOpenInput): { duplicate: boolean; record: TaskValidationRecord } {
    const params = parseAutopilotInput(TaskValidationOpenInputSchema, input, 'task validation')
    return runAutopilotWrite(this.db, 'autopilot_validation', () => {
      const spec = this.specs.get(params.taskId)
      if (!spec) {
        throw refused(
          'autopilot_task_spec_not_found',
          'The task has no TaskSpec to validate against.'
        )
      }
      this.requireClaimedAttempt(params.taskId, params.dispatchId, spec.runId)
      this.requirePolicyFollowsSpec(params.policy, spec)
      this.requireIndependentReview(params)
      const existing = this.db
        .prepare(`${SELECT_TASK_VALIDATION} WHERE dispatch_id = ? AND policy = ?`)
        .get(params.dispatchId, params.policy)
      if (existing) {
        const record = toTaskValidationRecord(existing)
        const same =
          record.validatorId === params.validatorId &&
          record.workerModel === params.workerModel &&
          record.reviewerModel === params.reviewerModel
        if (same) {
          return { duplicate: true, record }
        }
        throw refused('autopilot_validation_conflict', 'That attempt already has a validation.')
      }
      const validationId = `validation_${randomUUID()}`
      this.db
        .prepare(
          `INSERT INTO task_validations (validation_id, task_id, dispatch_id, policy, criteria_sha256, verdict,
            checks, validator_id, worker_model, reviewer_model, evidence_refs, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', '[]', ?, ?, ?, '[]', ?, ?)`
        )
        .run(
          validationId,
          params.taskId,
          params.dispatchId,
          params.policy,
          computeCriteriaSha256(spec),
          params.validatorId,
          params.workerModel,
          params.reviewerModel,
          params.timestamp,
          params.timestamp
        )
      const record = this.get(validationId)
      if (!record) {
        throw refused('autopilot_recovery_required', 'The validation row disappeared.')
      }
      return { duplicate: false, record }
    })
  }

  /** The executor's claim is recorded and the task waits: Dispatch open, worker ready at a waiting stage. */
  private requireClaimedAttempt(taskId: string, dispatchId: string, runId: string): void {
    const attempt = this.db
      .prepare(
        `SELECT d.status AS dispatch_status, w.state AS worker_state, w.stage AS worker_stage,
                t.status AS task_status
           FROM dispatch_contexts d
           LEFT JOIN worker_dispatches w ON w.dispatch_id = d.id
           LEFT JOIN tasks t ON t.id = d.task_id
          WHERE d.id = ? AND d.task_id = ? AND d.run_id = ?`
      )
      .get(dispatchId, taskId, runId)
    if (!attempt) {
      throw refused('autopilot_attempt_not_found', 'The attempt was not found.')
    }
    const waiting =
      attempt.dispatch_status === 'dispatched' &&
      attempt.worker_state === 'ready' &&
      APP_ATTEMPT_AWAITING_VALIDATION_STAGES.includes(String(attempt.worker_stage)) &&
      attempt.task_status === 'blocked'
    if (!waiting) {
      throw refused('autopilot_attempt_conflict', 'The attempt is not waiting for validation.')
    }
  }

  /**
   * D-027: a model review only when the TaskSpec asks for one. Everything else is recorded as
   * machine_checks: the TaskSpec's own checks, or the default process check or session report.
   */
  private requirePolicyFollowsSpec(policy: string, spec: TaskSpecRecord): void {
    const expected = spec.review === 'model' ? 'model_review' : 'machine_checks'
    if (policy !== expected) {
      throw refused(
        'autopilot_validation_policy_mismatch',
        `This TaskSpec is validated by ${expected}.`
      )
    }
  }

  private requireIndependentReview(params: TaskValidationOpenInput): void {
    if (params.policy !== 'model_review' || !params.workerModel || !params.reviewerModel) {
      return
    }
    if (isSameUnderlyingModel(params.workerModel, params.reviewerModel)) {
      throw refused(
        'autopilot_validation_not_independent',
        'A review must come from a different model than the one that did the work.'
      )
    }
  }
}

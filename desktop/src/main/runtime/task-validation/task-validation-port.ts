import { getAwaitingValidation } from '../orchestration/db/app-attempt-queries'
import {
  getAppAttemptSettlement,
  type AwaitingValidationEntry
} from '../orchestration/db/app-attempt-settlement'
import {
  getValidationOutcomeService,
  type RecordVerdictInput,
  type RejectInput,
  type ValidationOutcome,
  type WaiveInput
} from '../orchestration/db/app-attempt-validation-outcome'
import {
  getAttemptArtifactStore,
  type AttemptArtifactInput,
  type AttemptArtifactRecord
} from '../orchestration/db/attempt-artifact-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getTaskSpecStore, type TaskSpecRecord } from '../orchestration/db/task-spec-store'
import {
  getTaskValidationStore,
  type TaskValidationOpenInput,
  type TaskValidationRecord
} from '../orchestration/db/task-validation-store'

export type { AwaitingValidationEntry } from '../orchestration/db/app-attempt-settlement'
export type {
  RecordVerdictInput,
  RejectInput,
  ValidationOutcome,
  WaiveInput
} from '../orchestration/db/app-attempt-validation-outcome'

/**
 * What a validator may do: read the claimed attempt and its TaskSpec, record the evidence it finds,
 * and decide. It cannot waive or reject, which belong to the user and dot (ValidationDecisionPort),
 * and it has no way to set a task's status: a verdict is the only path that completes a task.
 */
export type TaskValidationPort = {
  listAwaiting(limit: number): AwaitingValidationEntry[]
  /** One waiting attempt, read alone so a batch never re-scans the whole list per attempt. */
  getAwaiting(dispatchId: string): AwaitingValidationEntry | null
  getSpec(taskId: string): TaskSpecRecord | null
  listArtifacts(dispatchId: string): AttemptArtifactRecord[]
  recordArtifact(input: AttemptArtifactInput): { duplicate: boolean; record: AttemptArtifactRecord }
  open(input: TaskValidationOpenInput): { duplicate: boolean; record: TaskValidationRecord }
  recordVerdict(input: RecordVerdictInput): ValidationOutcome
  getValidation(validationId: string): TaskValidationRecord | null
  /** True once a validator passed the task; the guard that refuses any other completion reads this. */
  hasPassingValidation(taskId: string): boolean
}

/** Resolving an inconclusive result is a decision for the user or dot, never for the primary session. */
export type ValidationDecisionPort = {
  listPendingDecisions(limit: number): AwaitingValidationEntry[]
  waive(input: WaiveInput): ValidationOutcome
  reject(input: RejectInput): ValidationOutcome
}

export function createTaskValidationPort(owner: OrchestrationDb): TaskValidationPort {
  const settlement = getAppAttemptSettlement(owner)
  const specs = getTaskSpecStore(owner)
  const artifacts = getAttemptArtifactStore(owner)
  const validations = getTaskValidationStore(owner)
  const outcome = getValidationOutcomeService(owner)
  return {
    listAwaiting: (limit) => settlement.listAwaitingValidation(limit),
    getAwaiting: (dispatchId) => getAwaitingValidation(owner.db, dispatchId),
    getSpec: (taskId) => specs.get(taskId),
    listArtifacts: (dispatchId) => artifacts.listForDispatch(dispatchId),
    recordArtifact: (input) => artifacts.record(input),
    open: (input) => validations.open(input),
    recordVerdict: (input) => outcome.recordVerdict(input),
    getValidation: (validationId) => validations.get(validationId),
    hasPassingValidation: (taskId) => validations.hasPassing(taskId)
  }
}

export function createValidationDecisionPort(owner: OrchestrationDb): ValidationDecisionPort {
  const settlement = getAppAttemptSettlement(owner)
  const outcome = getValidationOutcomeService(owner)
  return {
    listPendingDecisions: (limit) => settlement.listInconclusiveValidations(limit),
    waive: (input) => outcome.waive(input),
    reject: (input) => outcome.reject(input)
  }
}

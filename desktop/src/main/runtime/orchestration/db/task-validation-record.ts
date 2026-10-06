import { z } from 'zod'
import { parseJsonColumn } from './autopilot-json-column'
import { dispatchOrphanedSql, taskOrphanedSql } from './autopilot-orphan-detection'
import {
  TASK_VALIDATION_POLICIES,
  TASK_VALIDATION_VERDICTS,
  TASK_VALIDATION_WAIVERS
} from './autopilot-task-schema-definition'
import {
  AutopilotIdSchema,
  AutopilotModelIdSchema,
  ReasonCodeSchema,
  UtcTimestampSchema,
  parseStoredRow
} from './autopilot-store-input'

export const VALIDATION_CHECKS_MAX_ITEMS = 64
export const VALIDATION_CHECKS_MAX_CHARS = 16384
export const VALIDATION_EVIDENCE_MAX_ITEMS = 32
export const VALIDATION_EVIDENCE_MAX_CHARS = 8192
const VALIDATION_NOTE_MAX_CHARS = 500

const SingleLineText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => !/\p{Cc}/u.test(text))

export const VALIDATION_CHECK_STATUSES = ['pass', 'fail', 'inconclusive'] as const
export type ValidationCheckStatus = (typeof VALIDATION_CHECK_STATUSES)[number]

/** One check result; the note is short English text, never file contents. */
export const ValidationCheckSchema = z
  .object({
    kind: ReasonCodeSchema,
    status: z.enum(VALIDATION_CHECK_STATUSES),
    note: SingleLineText(VALIDATION_NOTE_MAX_CHARS).optional()
  })
  .strict()
export type ValidationCheck = z.infer<typeof ValidationCheckSchema>

/** A pointer to the evidence behind a result: an artifact id or a content hash, never the content. */
export const EvidenceRefSchema = z
  .object({ kind: ReasonCodeSchema, ref: SingleLineText(256) })
  .strict()
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>

export const ValidationChecksSchema = z
  .array(ValidationCheckSchema)
  .max(VALIDATION_CHECKS_MAX_ITEMS)
export const ValidationEvidenceSchema = z
  .array(EvidenceRefSchema)
  .max(VALIDATION_EVIDENCE_MAX_ITEMS)

export const TaskValidationOpenInputSchema = z
  .object({
    taskId: AutopilotIdSchema,
    dispatchId: AutopilotIdSchema,
    policy: z.enum(TASK_VALIDATION_POLICIES),
    validatorId: AutopilotIdSchema,
    workerModel: AutopilotModelIdSchema.nullable(),
    reviewerModel: AutopilotModelIdSchema.nullable(),
    timestamp: UtcTimestampSchema
  })
  .strict()
  .superRefine((input, context) => {
    // Why: only a model review names models; a machine check has no reviewer to be independent of.
    const review = input.policy === 'model_review'
    for (const field of ['workerModel', 'reviewerModel'] as const) {
      if (review !== (input[field] !== null)) {
        context.addIssue({ code: 'custom', path: [field], message: 'does not fit policy' })
      }
    }
  })
export type TaskValidationOpenInput = z.input<typeof TaskValidationOpenInputSchema>

export const ValidationVerdictInputSchema = z
  .object({
    validationId: AutopilotIdSchema,
    verdict: z.enum(['pass', 'fail', 'inconclusive']),
    checks: ValidationChecksSchema,
    evidenceRefs: ValidationEvidenceSchema,
    timestamp: UtcTimestampSchema
  })
  .strict()
export type ValidationVerdictInput = z.input<typeof ValidationVerdictInputSchema>

export const ValidationWaiverInputSchema = z
  .object({
    validationId: AutopilotIdSchema,
    waiver: z.enum(TASK_VALIDATION_WAIVERS),
    timestamp: UtcTimestampSchema
  })
  .strict()
export type ValidationWaiverInput = z.input<typeof ValidationWaiverInputSchema>

/** Effort variants some CLIs list as separate ids; the review must not be the same model under another name. */
const EFFORT_VARIANT_SUFFIX = /-(?:none|minimal|low|medium|high|xhigh|max|ultra)$/

export function underlyingModelId(modelId: string): string {
  return modelId.trim().toLowerCase().replace(EFFORT_VARIANT_SUFFIX, '')
}

/** True when two ids name one model: case, spacing and an effort-variant suffix do not make a new one. */
export function isSameUnderlyingModel(left: string, right: string): boolean {
  return underlyingModelId(left) === underlyingModelId(right)
}

export type TaskValidationRecord = {
  validationId: string
  taskId: string
  dispatchId: string
  policy: (typeof TASK_VALIDATION_POLICIES)[number]
  criteriaSha256: string
  verdict: (typeof TASK_VALIDATION_VERDICTS)[number]
  checks: ValidationCheck[]
  validatorId: string
  workerModel: string | null
  reviewerModel: string | null
  evidenceRefs: EvidenceRef[]
  waiver: (typeof TASK_VALIDATION_WAIVERS)[number] | null
  waivedAt: string | null
  createdAt: string
  updatedAt: string
  /** True once Orca no longer holds the task or the Dispatch, as after any Orca reset. */
  orphaned: boolean
}

const RowSchema = z.object({
  validation_id: z.string(),
  task_id: z.string(),
  dispatch_id: z.string(),
  policy: z.enum(TASK_VALIDATION_POLICIES),
  criteria_sha256: z.string(),
  verdict: z.enum(TASK_VALIDATION_VERDICTS),
  checks: z.string(),
  validator_id: z.string(),
  worker_model: z.string().nullable(),
  reviewer_model: z.string().nullable(),
  evidence_refs: z.string(),
  waiver: z.enum(TASK_VALIDATION_WAIVERS).nullable(),
  waived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  orphaned: z.number()
})

export const SELECT_TASK_VALIDATION = `SELECT validation_id, task_id, dispatch_id, policy, criteria_sha256, verdict,
  checks, validator_id, worker_model, reviewer_model, evidence_refs, waiver, waived_at, created_at, updated_at,
  (${taskOrphanedSql('task_validations.task_id')} OR ${dispatchOrphanedSql('task_validations.dispatch_id')}) AS orphaned
  FROM task_validations`

export function toTaskValidationRecord(row: unknown): TaskValidationRecord {
  const stored = parseStoredRow(RowSchema, row, 'task validation')
  return {
    validationId: stored.validation_id,
    taskId: stored.task_id,
    dispatchId: stored.dispatch_id,
    policy: stored.policy,
    criteriaSha256: stored.criteria_sha256,
    verdict: stored.verdict,
    checks: parseJsonColumn(stored.checks, ValidationChecksSchema, 'task validation'),
    validatorId: stored.validator_id,
    workerModel: stored.worker_model,
    reviewerModel: stored.reviewer_model,
    evidenceRefs: parseJsonColumn(
      stored.evidence_refs,
      ValidationEvidenceSchema,
      'task validation'
    ),
    waiver: stored.waiver,
    waivedAt: stored.waived_at,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
    orphaned: stored.orphaned === 1
  }
}

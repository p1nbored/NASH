import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson } from '../../../../shared/canonical-json'
import {
  TaskSpecMachineCheckListSchema,
  TaskSpecMachineCheckSchema,
  TaskSpecTextListSchema,
  TaskSpecTextSchema,
  TaskSpecTitleSchema,
  type TaskSpecMachineCheck
} from '../../../../shared/rpc-contract/autopilot-task-spec-fields'
import { WORKFLOW_RUN_ACCESS_LEVELS } from './autopilot-run-schema-definition'
import {
  TASK_ISOLATION_NEEDS,
  TASK_SPEC_DATA_CLASS,
  TASK_SPEC_REVIEW_REQUESTS
} from './autopilot-task-schema-definition'
import { parseJsonColumn } from './autopilot-json-column'
import { AutopilotIdSchema, UtcTimestampSchema, parseStoredRow } from './autopilot-store-input'

// D-027: no product size limits; the propose call holds the TaskSpec to its serialized ceiling.
// Why shared: the wire contract uses the same field definitions, so the two cannot drift (M6).
const SpecTextListSchema = TaskSpecTextListSchema
export const MachineCheckSchema = TaskSpecMachineCheckSchema
export type MachineCheck = TaskSpecMachineCheck
const MachineCheckListSchema = TaskSpecMachineCheckListSchema
const ReviewRequestSchema = z.enum(TASK_SPEC_REVIEW_REQUESTS)

export const TaskSpecInputSchema = z
  .object({
    taskId: AutopilotIdSchema,
    runId: AutopilotIdSchema,
    expectedOutputs: SpecTextListSchema,
    acceptanceCriteria: SpecTextListSchema,
    machineChecks: MachineCheckListSchema,
    constraints: SpecTextListSchema,
    accessNeed: z.enum(WORKFLOW_RUN_ACCESS_LEVELS),
    isolationNeed: z.enum(TASK_ISOLATION_NEEDS),
    workflowName: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
      .nullable(),
    review: ReviewRequestSchema.optional(),
    timestamp: UtcTimestampSchema
  })
  .strict()
export type TaskSpecInput = z.infer<typeof TaskSpecInputSchema>

const ProposalIdentityText = z.string().min(1).max(256)

/** A TaskSpec plus what Orca's own task row needs; the task id is Orca's, never the caller's. */
export const TaskProposalInputSchema = TaskSpecInputSchema.omit({ taskId: true })
  .extend({
    objective: TaskSpecTextSchema,
    taskTitle: TaskSpecTitleSchema.nullable().optional(),
    deps: z.array(AutopilotIdSchema).optional(),
    parentId: AutopilotIdSchema.nullable().optional(),
    createdBy: z
      .object({
        terminalHandle: ProposalIdentityText.optional(),
        paneKey: ProposalIdentityText.optional(),
        processIncarnation: ProposalIdentityText.optional(),
        runGeneration: z.number().int().positive().optional()
      })
      .strict()
      .optional()
  })
  .strict()
export type TaskProposalInput = z.input<typeof TaskProposalInputSchema>

export type TaskSpecRecord = {
  taskId: string
  runId: string
  specSha256: string
  expectedOutputs: string[]
  acceptanceCriteria: string[]
  machineChecks: MachineCheck[]
  constraints: string[]
  accessNeed: (typeof WORKFLOW_RUN_ACCESS_LEVELS)[number]
  isolationNeed: (typeof TASK_ISOLATION_NEEDS)[number]
  workflowName: string | null
  /** `model` when the TaskSpec asked for a model review (D-027); null otherwise. */
  review: (typeof TASK_SPEC_REVIEW_REQUESTS)[number] | null
  dataClass: typeof TASK_SPEC_DATA_CLASS
  createdAt: string
  /** True once Orca no longer holds the task, as after any Orca reset. */
  orphaned: boolean
}

const SPEC_HASH_VERSION = 1

/** Covers the objective Orca holds and every field, so a changed TaskSpec can never share a hash. */
export function computeTaskSpecSha256(objective: string, spec: TaskSpecInput): string {
  const content = canonicalJson({
    version: SPEC_HASH_VERSION,
    objective,
    expectedOutputs: spec.expectedOutputs,
    acceptanceCriteria: spec.acceptanceCriteria,
    machineChecks: spec.machineChecks,
    constraints: spec.constraints,
    accessNeed: spec.accessNeed,
    isolationNeed: spec.isolationNeed,
    workflowName: spec.workflowName,
    // Why only when set: a TaskSpec without a review request keeps the hash it had before D-027.
    ...(spec.review === undefined ? {} : { review: spec.review })
  })
  return createHash('sha256').update(content).digest('hex')
}

/** What the criteria were judged against: a validation names this, so a later spec change shows. */
export function computeCriteriaSha256(spec: {
  expectedOutputs: readonly string[]
  acceptanceCriteria: readonly string[]
  machineChecks: readonly MachineCheck[]
}): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        expectedOutputs: spec.expectedOutputs,
        acceptanceCriteria: spec.acceptanceCriteria,
        machineChecks: spec.machineChecks
      })
    )
    .digest('hex')
}

const RowSchema = z.object({
  task_id: z.string(),
  run_id: z.string(),
  spec_sha256: z.string(),
  expected_outputs: z.string(),
  acceptance_criteria: z.string(),
  machine_checks: z.string(),
  task_constraints: z.string(),
  access_need: z.enum(WORKFLOW_RUN_ACCESS_LEVELS),
  isolation_need: z.enum(TASK_ISOLATION_NEEDS),
  workflow_name: z.string().nullable(),
  review: ReviewRequestSchema.nullable(),
  data_class: z.literal(TASK_SPEC_DATA_CLASS),
  created_at: z.string(),
  orphaned: z.number()
})

export const TASK_SPEC_COLUMNS = `task_id, run_id, spec_sha256, expected_outputs, acceptance_criteria,
  machine_checks, task_constraints, access_need, isolation_need, workflow_name, review, data_class, created_at`

export function toTaskSpecRecord(row: unknown): TaskSpecRecord {
  const stored = parseStoredRow(RowSchema, row, 'task spec')
  return {
    taskId: stored.task_id,
    runId: stored.run_id,
    specSha256: stored.spec_sha256,
    expectedOutputs: parseJsonColumn(stored.expected_outputs, SpecTextListSchema, 'task spec'),
    acceptanceCriteria: parseJsonColumn(
      stored.acceptance_criteria,
      SpecTextListSchema,
      'task spec'
    ),
    machineChecks: parseJsonColumn(stored.machine_checks, MachineCheckListSchema, 'task spec'),
    constraints: parseJsonColumn(stored.task_constraints, SpecTextListSchema, 'task spec'),
    accessNeed: stored.access_need,
    isolationNeed: stored.isolation_need,
    workflowName: stored.workflow_name,
    review: stored.review,
    dataClass: stored.data_class,
    createdAt: stored.created_at,
    orphaned: stored.orphaned === 1
  }
}

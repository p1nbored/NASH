import { z } from 'zod'
import { AutopilotIdSchema } from './autopilot-identifier-fields'

/**
 * Desktop decisions on inconclusive validations (architecture section 9): the user waives a result
 * (the task completes) or rejects it (the task fails). The primary session has no route to these;
 * the decider is fixed by the endpoint, never named by the caller.
 */

export const WORKBENCH_VALIDATION_DECISIONS_DEFAULT_LIMIT = 50
export const WORKBENCH_VALIDATION_DECISIONS_MAX_LIMIT = 100

export const VALIDATION_DECISION_CHOICES = ['waive', 'reject'] as const
export type ValidationDecisionChoice = (typeof VALIDATION_DECISION_CHOICES)[number]

/** Where the attempt wrote: its own worktree, the folder itself, nowhere of its own, or not recorded. */
export const VALIDATION_DECISION_PLACEMENTS = [
  'own_worktree',
  'folder',
  'run_workspace',
  'in_session',
  'unrecorded'
] as const

export const DECISION_TITLE_MAX_CHARS = 240
export const DECISION_REASON_MAX_CHARS = 500
export const DECISION_BRANCH_MAX_CHARS = 1024
export const DECISION_PATH_MAX_CHARS = 4096

const BoundedText = (max: number) => z.string().max(max)

export const WorkbenchValidationListDecisionsParams = z
  .object({
    limit: z.number().int().min(1).max(WORKBENCH_VALIDATION_DECISIONS_MAX_LIMIT).optional()
  })
  .strict()

export const WorkbenchValidationDecideParams = z
  .object({ validationId: AutopilotIdSchema, decision: z.enum(VALIDATION_DECISION_CHOICES) })
  .strict()

export const WorkbenchValidationDecisionWorktreeSchema = z.object({
  branch: BoundedText(DECISION_BRANCH_MAX_CHARS),
  path: BoundedText(DECISION_PATH_MAX_CHARS),
  baseCommit: BoundedText(64)
})

// Why strings for placement and executor: a newer host may name one this build does not know; the
// renderer then shows a neutral label instead of failing the whole list.
export const WorkbenchValidationDecisionViewSchema = z.object({
  validationId: AutopilotIdSchema,
  runId: AutopilotIdSchema,
  taskId: AutopilotIdSchema,
  dispatchId: AutopilotIdSchema,
  /** The task title, or an excerpt of its objective, with secret shapes masked. */
  title: BoundedText(DECISION_TITLE_MAX_CHARS),
  executorKind: BoundedText(64),
  model: BoundedText(128).nullable(),
  /** Why validation could not decide, as one English line with secret shapes masked. */
  reason: BoundedText(DECISION_REASON_MAX_CHARS),
  inconclusiveAt: BoundedText(64),
  placement: BoundedText(32),
  worktree: WorkbenchValidationDecisionWorktreeSchema.nullable(),
  /** True when a process of the attempt may still run (tree live or unverifiable); desktop only. */
  processMayRun: z.boolean().optional()
})

export const WorkbenchValidationListDecisionsResultSchema = z.object({
  decisions: z
    .array(WorkbenchValidationDecisionViewSchema)
    .max(WORKBENCH_VALIDATION_DECISIONS_MAX_LIMIT),
  hasMore: z.boolean()
})

export const WorkbenchValidationDecideResultSchema = z.object({
  validationId: AutopilotIdSchema,
  taskId: AutopilotIdSchema,
  runId: AutopilotIdSchema,
  decision: z.enum(['waived', 'rejected']),
  taskStatus: BoundedText(64),
  /** True when the notice for the primary was filed in the run mailbox. */
  noticeFiled: z.boolean()
})

export type WorkbenchValidationListDecisionsInput = z.infer<
  typeof WorkbenchValidationListDecisionsParams
>
export type WorkbenchValidationDecideInput = z.infer<typeof WorkbenchValidationDecideParams>
export type WorkbenchValidationDecisionView = z.infer<typeof WorkbenchValidationDecisionViewSchema>
export type WorkbenchValidationListDecisionsResult = z.infer<
  typeof WorkbenchValidationListDecisionsResultSchema
>
export type WorkbenchValidationDecideResult = z.infer<typeof WorkbenchValidationDecideResultSchema>

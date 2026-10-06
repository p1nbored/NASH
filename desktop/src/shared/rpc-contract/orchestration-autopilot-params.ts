import { z } from 'zod'
import { AutopilotIdSchema } from './autopilot-identifier-fields'
import {
  TaskSpecMachineCheckListSchema,
  TaskSpecTextListSchema,
  TaskSpecTextSchema,
  TaskSpecTitleSchema
} from './autopilot-task-spec-fields'

/**
 * Wire contract of the primary session's task commands (D-016): task-propose, task-start,
 * task-show, task-report and run-complete. The caller is the attested pane of the request, so no
 * param names a caller or a run. No param carries an execution target, model, effort, data class or
 * language: Clef classifies, the Routing Table selects, and the run fixes the deliverable language.
 */

/** Each server wait returns within this, below the socket idle limit, so the CLI loops. */
export const AUTOPILOT_WAIT_SLICE_MAX_MS = 20_000
/** Claude Code's default Bash tool timeout (env-vars.md, `BASH_DEFAULT_TIMEOUT_MS`). */
export const AUTOPILOT_BASH_DEFAULT_TIMEOUT_MS = 120_000
/** How long one CLI invocation keeps waiting, so a slice in flight still ends before the Bash timeout. */
export const AUTOPILOT_CLI_WAIT_BUDGET_MS = 90_000

/** D-027: the one technical ceiling of a TaskSpec, on its serialized UTF-8 bytes; no product size limits. */
export const AUTOPILOT_TASK_SPEC_MAX_BYTES = 256 * 1024
/** A model review runs only when the TaskSpec asks for one (D-027). */
export const AUTOPILOT_TASK_REVIEW_REQUESTS = ['model'] as const
/** The run-mailbox notice body cap, where an in-session report is kept. */
export const AUTOPILOT_REPORT_SUMMARY_MAX_CHARS = 2000
export const AUTOPILOT_RUN_SUMMARY_MAX_CHARS = 4000

/** Keys a TaskSpec never carries; named here so the refusal can say why each is not accepted. */
export const AUTOPILOT_TASK_SPEC_REFUSED_KEYS = [
  'target',
  'executionTarget',
  'execution_target',
  'model',
  'effort',
  'reasoning',
  'reasoningLevel',
  'reasoning_level',
  'thinking',
  'profile',
  'surface',
  'dataClass',
  'data_class',
  'language',
  'deliverableLanguage',
  'deliverable_language'
] as const

/**
 * The TaskSpec the primary writes, English preferred with names and paths in backticks (D-013).
 * D-027: only the objective is required, and only the serialized ceiling bounds its size. Text and
 * machine-check fields share the store's definition (autopilot-task-spec-fields.ts).
 */
export const AutopilotTaskSpecSchema = z
  .object({
    objective: TaskSpecTextSchema,
    title: TaskSpecTitleSchema.optional(),
    expectedOutputs: TaskSpecTextListSchema.optional(),
    acceptanceCriteria: TaskSpecTextListSchema.optional(),
    machineChecks: TaskSpecMachineCheckListSchema.optional(),
    constraints: TaskSpecTextListSchema.optional(),
    accessNeed: z.enum(['read_only', 'workspace_write']).optional(),
    isolationNeed: z.enum(['none', 'worktree']).optional(),
    workflowName: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
      .optional(),
    deps: z.array(AutopilotIdSchema).optional(),
    parentId: AutopilotIdSchema.optional(),
    review: z.enum(AUTOPILOT_TASK_REVIEW_REQUESTS).optional()
  })
  .strict()
export type AutopilotTaskSpec = z.infer<typeof AutopilotTaskSpecSchema>

/** UTF-8 bytes of the TaskSpec as JSON, the measure its technical ceiling applies to. */
export function taskSpecSerializedBytes(spec: unknown): number {
  return new TextEncoder().encode(JSON.stringify(spec)).byteLength
}

export const TaskProposeParams = z.object({ spec: AutopilotTaskSpecSchema }).strict()
export type TaskProposeInput = z.infer<typeof TaskProposeParams>

export const TaskStartParams = z.object({ taskId: AutopilotIdSchema }).strict()
export type TaskStartParamsInput = z.infer<typeof TaskStartParams>

export const TaskShowParams = z
  .object({
    taskId: AutopilotIdSchema,
    waitMs: z.number().int().min(0).max(AUTOPILOT_WAIT_SLICE_MAX_MS).optional()
  })
  .strict()
export type TaskShowInput = z.infer<typeof TaskShowParams>

export const AUTOPILOT_REPORT_OUTCOMES = ['succeeded', 'failed'] as const

export const TaskReportParams = z
  .object({
    taskId: AutopilotIdSchema,
    attemptId: AutopilotIdSchema,
    outcome: z.enum(AUTOPILOT_REPORT_OUTCOMES),
    summary: z.string().min(1).max(AUTOPILOT_REPORT_SUMMARY_MAX_CHARS)
  })
  .strict()
export type TaskReportInput = z.infer<typeof TaskReportParams>

export const RunCompleteParams = z
  .object({ summary: z.string().min(1).max(AUTOPILOT_RUN_SUMMARY_MAX_CHARS) })
  .strict()
export type RunCompleteInput = z.infer<typeof RunCompleteParams>

const REFUSED: ReadonlySet<string> = new Set(AUTOPILOT_TASK_SPEC_REFUSED_KEYS)
const KEY_SCAN_DEPTH = 4

function childrenOf(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) {
    return value.map((item: unknown): [string, unknown] => ['', item])
  }
  return value !== null && typeof value === 'object' ? Object.entries(value) : []
}

function collectRefusedKeys(value: unknown, depth: number, found: Set<string>): void {
  if (depth > KEY_SCAN_DEPTH) {
    return
  }
  for (const [key, item] of childrenOf(value)) {
    if (REFUSED.has(key)) {
      found.add(key)
    }
    collectRefusedKeys(item, depth + 1, found)
  }
}

/** The routing and language keys a parsed TaskSpec document names anywhere, sorted. */
export function findRefusedTaskSpecKeys(value: unknown): string[] {
  const found = new Set<string>()
  collectRefusedKeys(value, 0, found)
  return [...found].sort()
}

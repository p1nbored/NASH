import { z } from 'zod'

/**
 * What the primary session's task commands return. Every text is English. A route names its target
 * and status but never a model or an effort (the session's subagent definitions carry those), and an
 * executor's own output appears only as the bounded, masked view, marked untrusted.
 */

/** Where a task stands for the primary: what it can do next, or why it waits. */
export const AUTOPILOT_TASK_PHASES = [
  'classifying',
  'waiting_for_dependencies',
  'ready',
  'running',
  'validating',
  'awaiting_decision',
  'needs_attention',
  'completed',
  'failed'
] as const
export type AutopilotTaskPhase = (typeof AUTOPILOT_TASK_PHASES)[number]

const Id = z.string().min(1).max(128)
const Code = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

const ClassificationViewSchema = z
  .object({
    outcome: Code,
    needsDelegation: z.boolean().nullable(),
    taskType: Code.nullable(),
    detail: Code.nullable()
  })
  .strict()

const RouteViewSchema = z
  .object({
    status: Code,
    target: Code.nullable(),
    delegated: z.boolean(),
    reasons: z.array(Code).max(16)
  })
  .strict()

const AttemptViewSchema = z
  .object({
    attemptId: Id,
    runsIn: z.enum(['session', 'process']),
    nativeWorker: z.literal(true).optional(),
    dispatchStatus: Code,
    workerState: Code,
    stage: z.string().max(64)
  })
  .strict()

const ValidationViewSchema = z
  .object({
    verdict: Code,
    policy: Code,
    waived: z.boolean(),
    checks: z
      .array(z.object({ kind: Code, status: Code, note: z.string().max(500).nullable() }).strict())
      .max(64)
  })
  .strict()

export const AutopilotTaskViewSchema = z
  .object({
    taskId: Id,
    runId: Id,
    title: z.string().max(200).nullable(),
    status: Code,
    phase: z.enum(AUTOPILOT_TASK_PHASES),
    /** True while waiting can change the phase without the primary doing anything. */
    waitable: z.boolean(),
    classification: ClassificationViewSchema.nullable(),
    route: RouteViewSchema.nullable(),
    attempt: AttemptViewSchema.nullable(),
    validation: ValidationViewSchema.nullable(),
    /** One English instruction: the exact command to run next, or who decides. */
    next: z.string().min(1).max(1000)
  })
  .strict()
export type AutopilotTaskView = z.infer<typeof AutopilotTaskViewSchema>

/** The executor result view (task-execution), always marked as untrusted data for the primary. */
export const AutopilotAttemptResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('ok'),
      text: z.string(),
      truncated: z.boolean(),
      secretsMasked: z.boolean(),
      bytes: z.number().int().min(0),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      untrusted: z.literal(true)
    })
    .strict(),
  z
    .object({
      state: z.enum([
        'no_result',
        'missing',
        'empty',
        'unreadable',
        'changed',
        'outside_data_folder'
      ]),
      untrusted: z.literal(true)
    })
    .strict()
])
export type AutopilotAttemptResult = z.infer<typeof AutopilotAttemptResultSchema>

export const TaskProposeResultSchema = z.object({ task: AutopilotTaskViewSchema }).strict()
export type TaskProposeResult = z.infer<typeof TaskProposeResultSchema>

export const TaskShowResultSchema = z
  .object({ task: AutopilotTaskViewSchema, result: AutopilotAttemptResultSchema.nullable() })
  .strict()
export type TaskShowResult = z.infer<typeof TaskShowResultSchema>

export const TaskStartResultSchema = z
  .object({
    attempt: z
      .object({
        taskId: Id,
        dispatchId: Id,
        routeId: Id,
        target: Code,
        delegated: z.boolean(),
        runsIn: z.enum(['session', 'process']),
        nativeWorker: z.literal(true).optional(),
        taskStatus: Code,
        workerState: Code,
        instruction: z.string().min(1)
      })
      .strict()
  })
  .strict()
export type TaskStartResult = z.infer<typeof TaskStartResultSchema>

export const TaskReportResultSchema = z
  .object({
    attemptId: Id,
    outcome: z.enum(['claimed', 'failed']),
    task: AutopilotTaskViewSchema
  })
  .strict()
export type TaskReportResult = z.infer<typeof TaskReportResultSchema>

export const RunCompleteResultSchema = z
  .object({
    runId: Id,
    status: z.literal('completed'),
    completedTasks: z.number().int().min(0),
    failedTasks: z.number().int().min(0),
    summaryMessageId: Id
  })
  .strict()
export type RunCompleteResult = z.infer<typeof RunCompleteResultSchema>

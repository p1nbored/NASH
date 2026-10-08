import { z } from 'zod'
import { WorkflowRunIdSchema } from '../workflow-run/workflow-run-view'

export const TASK_WINDOW_EXECUTOR_KINDS = [
  'codex',
  'agy',
  'claude_subagent',
  'claude_workflow',
  'claude_primary'
] as const
export type TaskWindowExecutorKind = (typeof TASK_WINDOW_EXECUTOR_KINDS)[number]

/** The executor process states, plus the same words for a Claude task's Orca Dispatch. */
export const TASK_WINDOW_ATTEMPT_STATES = [
  'starting',
  'running',
  'completed',
  'failed',
  'blocked',
  'stopped',
  'stop_unknown',
  'start_unknown'
] as const
export type TaskWindowAttemptState = (typeof TASK_WINDOW_ATTEMPT_STATES)[number]

const TaskWindowIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
const BoundedText = (max: number) => z.string().max(max)

export const WorkbenchRunTasksParams = z.object({ runId: WorkflowRunIdSchema }).strict()

export const WorkbenchTaskSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session'),
    worktreeId: BoundedText(4096),
    sessionId: BoundedText(256),
    agent: z.enum(['claude', 'codex', 'antigravity'])
  }),
  z.object({ kind: z.literal('terminal'), terminal: BoundedText(4096) })
])

// Why strings: a newer host may name an executor or state this build does not know; the
// renderer shows a neutral label instead of failing the whole list.
export const WorkbenchRunTaskAttemptSchema = z.object({
  dispatchId: TaskWindowIdSchema,
  state: BoundedText(64),
  startedAt: BoundedText(64),
  settledAt: BoundedText(64).nullable(),
  source: WorkbenchTaskSourceSchema.nullable()
})

export const WorkbenchRunTaskSchema = z.object({
  taskId: TaskWindowIdSchema,
  title: BoundedText(512).nullable(),
  executorKind: BoundedText(64),
  attempts: z.array(WorkbenchRunTaskAttemptSchema)
})

export const WorkbenchRunTasksResultSchema = z.object({ tasks: z.array(WorkbenchRunTaskSchema) })

export type WorkbenchRunTasksInput = z.infer<typeof WorkbenchRunTasksParams>
export type WorkbenchTaskSource = z.infer<typeof WorkbenchTaskSourceSchema>
export type WorkbenchRunTaskAttempt = z.infer<typeof WorkbenchRunTaskAttemptSchema>
export type WorkbenchRunTask = z.infer<typeof WorkbenchRunTaskSchema>
export type WorkbenchRunTasksResult = z.infer<typeof WorkbenchRunTasksResultSchema>

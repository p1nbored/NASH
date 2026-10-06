import { z } from 'zod'
import { WorkflowRunIdSchema } from '../workflow-run/workflow-run-view'

/**
 * D-024 task window: desktop-only params and results for a run's task list and an attempt's
 * transcript. No path crosses the wire; the host resolves the transcript from its own records.
 */

/** Design section 1.2: one read returns at most 256 KiB. */
export const ATTEMPT_TRANSCRIPT_READ_MAX_BYTES = 262_144

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

export const WorkbenchAttemptTranscriptReadParams = z
  .object({
    dispatchId: TaskWindowIdSchema,
    fromByteOffset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    maxBytes: z.number().int().min(1).max(ATTEMPT_TRANSCRIPT_READ_MAX_BYTES)
  })
  .strict()

export const TaskWindowWorktreeSchema = z.object({
  branch: BoundedText(256),
  path: BoundedText(4096),
  baseCommit: BoundedText(64),
  merged: z.boolean()
})

// Why strings: a newer host may name an executor or state this build does not know; the
// renderer shows a neutral label instead of failing the whole list.
export const WorkbenchRunTaskAttemptSchema = z.object({
  dispatchId: TaskWindowIdSchema,
  state: BoundedText(64),
  startedAt: BoundedText(64),
  settledAt: BoundedText(64).nullable(),
  hasTranscript: z.boolean(),
  worktree: TaskWindowWorktreeSchema.nullable()
})

export const WorkbenchRunTaskSchema = z.object({
  taskId: TaskWindowIdSchema,
  title: BoundedText(512).nullable(),
  executorKind: BoundedText(64),
  attempts: z.array(WorkbenchRunTaskAttemptSchema)
})

export const WorkbenchRunTasksResultSchema = z.object({ tasks: z.array(WorkbenchRunTaskSchema) })

/**
 * `chunk` holds whole lines only, so `nextByteOffset` always starts a line. `truncated` says the
 * writer hit its size cap; `ended` says this read reached the `end` record at the end of the file.
 */
export const WorkbenchAttemptTranscriptReadResultSchema = z.object({
  chunk: z.string(),
  nextByteOffset: z.number().int().min(0),
  fileIdentity: BoundedText(128),
  reset: z.boolean(),
  truncated: z.boolean(),
  live: z.boolean(),
  ended: z.boolean()
})

export type WorkbenchRunTasksInput = z.infer<typeof WorkbenchRunTasksParams>
export type WorkbenchAttemptTranscriptReadInput = z.infer<
  typeof WorkbenchAttemptTranscriptReadParams
>
export type TaskWindowWorktree = z.infer<typeof TaskWindowWorktreeSchema>
export type WorkbenchRunTaskAttempt = z.infer<typeof WorkbenchRunTaskAttemptSchema>
export type WorkbenchRunTask = z.infer<typeof WorkbenchRunTaskSchema>
export type WorkbenchRunTasksResult = z.infer<typeof WorkbenchRunTasksResultSchema>
export type WorkbenchAttemptTranscriptReadResult = z.infer<
  typeof WorkbenchAttemptTranscriptReadResultSchema
>

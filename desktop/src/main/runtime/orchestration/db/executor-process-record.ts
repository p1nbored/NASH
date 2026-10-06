import { z } from 'zod'
import { JsonObjectSchema, parseNullableJsonColumn } from './autopilot-json-column'
import { dispatchOrphanedSql } from './autopilot-orphan-detection'
import { RelativePathSchema } from './autopilot-relative-path'
import {
  EXECUTOR_KINDS,
  EXECUTOR_PROCESS_STATES,
  EXECUTOR_TREE_METHODS,
  EXECUTOR_TREE_VERDICTS
} from './autopilot-task-schema-definition'
import { AutopilotIdSchema, UtcTimestampSchema, parseStoredRow } from './autopilot-store-input'

export const ExecutorProcessStartInputSchema = z
  .object({
    dispatchId: AutopilotIdSchema,
    runId: AutopilotIdSchema,
    taskId: AutopilotIdSchema,
    executorKind: z.enum(EXECUTOR_KINDS),
    routeId: AutopilotIdSchema,
    runDirectory: RelativePathSchema,
    timestamp: UtcTimestampSchema
  })
  .strict()
export type ExecutorProcessStartInput = z.input<typeof ExecutorProcessStartInputSchema>

export type ExecutorProcessRecord = {
  dispatchId: string
  runId: string
  taskId: string
  executorKind: (typeof EXECUTOR_KINDS)[number]
  routeId: string
  state: (typeof EXECUTOR_PROCESS_STATES)[number]
  executableEvidence: z.infer<typeof JsonObjectSchema> | null
  runDirectory: string
  threadId: string | null
  treeVerdict: (typeof EXECUTOR_TREE_VERDICTS)[number] | null
  treeMethod: (typeof EXECUTOR_TREE_METHODS)[number] | null
  stopVerdict: (typeof EXECUTOR_TREE_VERDICTS)[number] | null
  exitCode: number | null
  verdict: z.infer<typeof JsonObjectSchema> | null
  /** Evidence about the executor's last message only; the message itself stays in the run directory. */
  lastMessage: { sha256: string; bytes: number; secretLike: boolean } | null
  usage: z.infer<typeof JsonObjectSchema> | null
  startedAt: string
  settledAt: string | null
  /** True once Orca no longer holds the Dispatch, as after any Orca reset. */
  orphaned: boolean
}

const RowSchema = z.object({
  dispatch_id: z.string(),
  run_id: z.string(),
  task_id: z.string(),
  executor_kind: z.enum(EXECUTOR_KINDS),
  route_id: z.string(),
  state: z.enum(EXECUTOR_PROCESS_STATES),
  executable_evidence: z.string().nullable(),
  run_directory: z.string(),
  thread_id: z.string().nullable(),
  tree_verdict: z.enum(EXECUTOR_TREE_VERDICTS).nullable(),
  tree_method: z.enum(EXECUTOR_TREE_METHODS).nullable(),
  stop_verdict: z.enum(EXECUTOR_TREE_VERDICTS).nullable(),
  exit_code: z.number().nullable(),
  verdict: z.string().nullable(),
  last_message_sha256: z.string().nullable(),
  last_message_bytes: z.number().nullable(),
  secret_shaped: z.number().nullable(),
  usage: z.string().nullable(),
  started_at: z.string(),
  settled_at: z.string().nullable(),
  orphaned: z.number()
})

export const SELECT_EXECUTOR_PROCESS = `SELECT dispatch_id, run_id, task_id, executor_kind, route_id, state,
  executable_evidence, run_directory, thread_id, tree_verdict, tree_method, stop_verdict, exit_code, verdict,
  last_message_sha256, last_message_bytes, secret_shaped, usage, started_at, settled_at,
  ${dispatchOrphanedSql('executor_processes.dispatch_id')} AS orphaned FROM executor_processes`

export function toExecutorProcessRecord(row: unknown): ExecutorProcessRecord {
  const stored = parseStoredRow(RowSchema, row, 'executor process')
  const hasMessage =
    stored.last_message_sha256 !== null &&
    stored.last_message_bytes !== null &&
    stored.secret_shaped !== null
  return {
    dispatchId: stored.dispatch_id,
    runId: stored.run_id,
    taskId: stored.task_id,
    executorKind: stored.executor_kind,
    routeId: stored.route_id,
    state: stored.state,
    executableEvidence: parseNullableJsonColumn(
      stored.executable_evidence,
      JsonObjectSchema,
      'executor process'
    ),
    runDirectory: stored.run_directory,
    threadId: stored.thread_id,
    treeVerdict: stored.tree_verdict,
    treeMethod: stored.tree_method,
    stopVerdict: stored.stop_verdict,
    exitCode: stored.exit_code,
    verdict: parseNullableJsonColumn(stored.verdict, JsonObjectSchema, 'executor process'),
    lastMessage: hasMessage
      ? {
          sha256: stored.last_message_sha256 ?? '',
          bytes: stored.last_message_bytes ?? 0,
          secretLike: stored.secret_shaped === 1
        }
      : null,
    usage: parseNullableJsonColumn(stored.usage, JsonObjectSchema, 'executor process'),
    startedAt: stored.started_at,
    settledAt: stored.settled_at,
    orphaned: stored.orphaned === 1
  }
}

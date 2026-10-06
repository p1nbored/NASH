import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import { JsonObjectSchema, toNullableJsonColumn } from './autopilot-json-column'
import {
  EXECUTOR_PROCESS_STATES,
  EXECUTOR_TREE_METHODS,
  EXECUTOR_TREE_VERDICTS
} from './autopilot-task-schema-definition'
import {
  AutopilotIdSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
  changedRowCount,
  parseAutopilotInput
} from './autopilot-store-input'

export type ExecutorProcessState = (typeof EXECUTOR_PROCESS_STATES)[number]

export const EXECUTOR_EVIDENCE_MAX_CHARS = 4096
export const EXECUTOR_VERDICT_MAX_CHARS = 8192
export const EXECUTOR_USAGE_MAX_CHARS = 2048

function edges(...to: ExecutorProcessState[]): readonly ExecutorProcessState[] {
  return Object.freeze(to)
}

// Why: only a start that proved nothing ran may end as stopped from `starting`; a start of unknown
// outcome stays unknown, and an unproven stop can only be settled by a later proof of exit.
export const EXECUTOR_PROCESS_TRANSITIONS: Readonly<
  Record<ExecutorProcessState, readonly ExecutorProcessState[]>
> = Object.freeze({
  starting: edges('running', 'failed', 'start_unknown', 'stopped', 'stop_unknown'),
  running: edges('completed', 'failed', 'blocked', 'stopped', 'stop_unknown'),
  completed: edges(),
  failed: edges(),
  blocked: edges(),
  stopped: edges(),
  stop_unknown: edges('stopped'),
  start_unknown: edges()
})

const TreeSchema = z
  .object({ verdict: z.enum(EXECUTOR_TREE_VERDICTS), method: z.enum(EXECUTOR_TREE_METHODS) })
  .strict()
const LastMessageSchema = z
  .object({
    sha256: Sha256HexSchema,
    bytes: z.number().int().min(0),
    secretLike: z.boolean()
  })
  .strict()

/** The evidence fields a settlement can carry; each stays optional, and the target state decides which are required. */
export const ExecutorEvidenceShape = {
  threadId: z.string().min(1).max(256).nullable().optional(),
  exitCode: z.number().int().nullable().optional(),
  verdict: JsonObjectSchema.nullable().optional(),
  tree: TreeSchema.nullable().optional(),
  stopVerdict: z.enum(EXECUTOR_TREE_VERDICTS).nullable().optional(),
  lastMessage: LastMessageSchema.nullable().optional(),
  usage: JsonObjectSchema.nullable().optional()
}

export const ExecutorTransitionSchema = z
  .object({
    dispatchId: AutopilotIdSchema,
    from: z.enum(EXECUTOR_PROCESS_STATES),
    to: z.enum(EXECUTOR_PROCESS_STATES),
    timestamp: UtcTimestampSchema,
    executableEvidence: JsonObjectSchema.nullable().optional(),
    ...ExecutorEvidenceShape
  })
  .strict()
export type ExecutorTransition = z.input<typeof ExecutorTransitionSchema>
type ParsedTransition = z.output<typeof ExecutorTransitionSchema>

const PROCESS_SETTLED_STATES: ReadonlySet<ExecutorProcessState> = new Set([
  'completed',
  'failed',
  'blocked'
])

/** The fields a target state stands on, and the ones it must not carry. */
function evidenceProblems(transition: ParsedTransition): string[] {
  const { to } = transition
  const problems: string[] = []
  const flag = (field: string, wrong: boolean) => {
    if (wrong) {
      problems.push(field)
    }
  }
  flag('executableEvidence', (to === 'running') !== Boolean(transition.executableEvidence))
  flag('lastMessage', Boolean(transition.lastMessage) && !PROCESS_SETTLED_STATES.has(to))
  flag('tree', Boolean(transition.tree) && to === 'start_unknown')
  flag('tree', !transition.tree && PROCESS_SETTLED_STATES.has(to))
  flag('exitCode', to === 'completed' && transition.exitCode !== 0)
  flag('exitCode', to === 'start_unknown' && transition.exitCode != null)
  flag('lastMessage', to === 'completed' && !transition.lastMessage)
  flag('stopVerdict', to === 'stopped' && transition.stopVerdict !== 'exited')
  flag(
    'stopVerdict',
    to === 'stop_unknown' &&
      transition.stopVerdict !== 'live' &&
      transition.stopVerdict !== 'unverifiable'
  )
  flag('stopVerdict', to !== 'stopped' && to !== 'stop_unknown' && Boolean(transition.stopVerdict))
  return [...new Set(problems)]
}

function invalidEvidence(fields: string[]): OrchestrationError {
  return new OrchestrationError('autopilot_invalid_input', 'Invalid executor transition.', {
    fields
  })
}

/**
 * One compare-and-set on the stated state. The caller owns the transaction, so the executor row moves
 * together with Orca's Dispatch, worker and Task; calling it outside one is refused.
 */
export function applyExecutorTransition(db: Database.Database, input: ExecutorTransition): void {
  const transition = parseAutopilotInput(ExecutorTransitionSchema, input, 'executor transition')
  if (!EXECUTOR_PROCESS_TRANSITIONS[transition.from].includes(transition.to)) {
    throw new OrchestrationError(
      'autopilot_invalid_transition',
      `An executor cannot move from ${transition.from} to ${transition.to}.`
    )
  }
  const problems = evidenceProblems(transition)
  if (problems.length > 0) {
    throw invalidEvidence(problems)
  }
  const executableEvidence = toNullableJsonColumn(
    transition.executableEvidence,
    EXECUTOR_EVIDENCE_MAX_CHARS,
    'executable evidence'
  )
  const verdict = toNullableJsonColumn(transition.verdict, EXECUTOR_VERDICT_MAX_CHARS, 'verdict')
  const usage = toNullableJsonColumn(transition.usage, EXECUTOR_USAGE_MAX_CHARS, 'usage')
  if (!db.isTransaction) {
    throw new OrchestrationError(
      'autopilot_transaction_required',
      'An executor transition must run inside the transaction that moves the attempt.'
    )
  }
  const message = transition.lastMessage
  const result = db
    .prepare(
      `UPDATE executor_processes SET state = ?, settled_at = ?,
        executable_evidence = COALESCE(?, executable_evidence), thread_id = COALESCE(?, thread_id),
        exit_code = COALESCE(?, exit_code), verdict = COALESCE(?, verdict),
        tree_verdict = COALESCE(?, tree_verdict), tree_method = COALESCE(?, tree_method),
        stop_verdict = COALESCE(?, stop_verdict), last_message_sha256 = COALESCE(?, last_message_sha256),
        last_message_bytes = COALESCE(?, last_message_bytes), secret_shaped = COALESCE(?, secret_shaped),
        usage = COALESCE(?, usage) WHERE dispatch_id = ? AND state = ?`
    )
    .run(
      transition.to,
      transition.to === 'running' ? null : transition.timestamp,
      executableEvidence,
      transition.threadId ?? null,
      transition.exitCode ?? null,
      verdict,
      transition.tree?.verdict ?? null,
      transition.tree?.method ?? null,
      transition.stopVerdict ?? null,
      message?.sha256 ?? null,
      message?.bytes ?? null,
      message ? Number(message.secretLike) : null,
      usage,
      transition.dispatchId,
      transition.from
    )
  if (changedRowCount(result) === 1) {
    return
  }
  const exists = db
    .prepare('SELECT 1 AS found FROM executor_processes WHERE dispatch_id = ?')
    .get(transition.dispatchId)
  throw exists
    ? new OrchestrationError(
        'autopilot_executor_conflict',
        'The executor changed. Nothing was written.'
      )
    : new OrchestrationError('autopilot_executor_not_found', 'The executor was not found.')
}

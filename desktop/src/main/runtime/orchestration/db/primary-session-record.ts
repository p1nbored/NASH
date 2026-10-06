import { z } from 'zod'
import { OrchestrationError } from '../orchestration-error'
import {
  AUTOPILOT_EFFORT_LEVELS,
  PRIMARY_SESSION_LEDGERS,
  PRIMARY_SESSION_PERMISSION_MODES,
  PRIMARY_SESSION_RECEIPT_MAX_CHARS,
  PRIMARY_SESSION_STATES
} from './autopilot-run-schema-definition'
import {
  AutopilotEffortSchema,
  AutopilotIdSchema,
  AutopilotModelIdSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
  parseStoredRow
} from './autopilot-store-input'

export type PrimarySessionState = (typeof PRIMARY_SESSION_STATES)[number]
export type PrimarySessionPermissionMode = (typeof PRIMARY_SESSION_PERMISSION_MODES)[number]

function edges(...to: PrimarySessionState[]): readonly PrimarySessionState[] {
  return Object.freeze(to)
}

// Why: running needs the pane identity markRunning supplies; stopped is our own stop, exited an
// observed exit; unverifiable stays live until reconciled.
export const PRIMARY_SESSION_TRANSITIONS: Readonly<
  Record<PrimarySessionState, readonly PrimarySessionState[]>
> = Object.freeze({
  starting: edges('running', 'stopped', 'unverifiable'),
  running: edges('stopping', 'exited', 'unverifiable'),
  stopping: edges('stopped', 'exited', 'unverifiable'),
  stopped: edges(),
  exited: edges(),
  unverifiable: edges('running', 'stopping', 'exited')
})

/** States entered with a reason code; every other state takes none. */
export const PRIMARY_SESSION_STATES_WITH_REASON: ReadonlySet<PrimarySessionState> = new Set([
  'stopped',
  'exited',
  'unverifiable'
])
export const PRIMARY_SESSION_ENDED_STATES: ReadonlySet<PrimarySessionState> = new Set([
  'stopped',
  'exited'
])

/** Refuses everything outside manual, acceptEdits and plan, including `default` and the locked modes. */
export function requirePrimarySessionPermissionMode(mode: unknown): PrimarySessionPermissionMode {
  const allowed = PRIMARY_SESSION_PERMISSION_MODES.find((candidate) => candidate === mode)
  if (!allowed) {
    throw new OrchestrationError(
      'autopilot_permission_mode_refused',
      'The primary session may only run in manual, acceptEdits or plan mode.'
    )
  }
  return allowed
}

export const PrimarySessionInsertSchema = z
  .object({
    runId: AutopilotIdSchema,
    launchOperationId: AutopilotIdSchema,
    // Why: a string at the boundary, so the store itself refuses a locked mode that arrives as data.
    permissionMode: z.string(),
    requestedModel: AutopilotModelIdSchema,
    requestedEffort: AutopilotEffortSchema,
    timestamp: UtcTimestampSchema
  })
  .strict()
export type PrimarySessionInsert = z.infer<typeof PrimarySessionInsertSchema>

const IdentityText = z.string().min(1).max(256)
const ReceiptObjectSchema = z.record(z.string(), z.unknown())
const ReceiptSchema = ReceiptObjectSchema.refine((receipt) => {
  try {
    return JSON.stringify(receipt).length <= PRIMARY_SESSION_RECEIPT_MAX_CHARS
  } catch {
    return false
  }
})
export const PrimarySessionRunningSchema = z
  .object({
    terminalHandle: IdentityText,
    paneKey: IdentityText,
    processIncarnation: IdentityText,
    launchTokenSha256: Sha256HexSchema.nullable(),
    launchLedger: z.enum(PRIMARY_SESSION_LEDGERS),
    receipt: ReceiptSchema,
    timestamp: UtcTimestampSchema
  })
  .strict()
export type PrimarySessionRunning = z.infer<typeof PrimarySessionRunningSchema>

export const PrimarySessionTransitionSchema = z
  .object({
    ownerId: AutopilotIdSchema,
    from: z.enum(PRIMARY_SESSION_STATES),
    to: z.enum(PRIMARY_SESSION_STATES),
    reason: z.string().nullable(),
    timestamp: UtcTimestampSchema
  })
  .strict()
export type PrimarySessionTransition = z.infer<typeof PrimarySessionTransitionSchema>

const RowSchema = z.object({
  owner_id: z.string(),
  run_id: z.string(),
  generation: z.number(),
  launch_operation_id: z.string(),
  launch_ledger: z.enum(PRIMARY_SESSION_LEDGERS).nullable(),
  terminal_handle: z.string().nullable(),
  pane_key: z.string().nullable(),
  process_incarnation: z.string().nullable(),
  launch_token_sha256: z.string().nullable(),
  permission_mode: z.enum(PRIMARY_SESSION_PERMISSION_MODES),
  requested_model: z.string(),
  requested_effort: z.enum(AUTOPILOT_EFFORT_LEVELS),
  state: z.enum(PRIMARY_SESSION_STATES),
  receipt: z.string().nullable(),
  end_reason: z.string().nullable(),
  started_at: z.string(),
  updated_at: z.string(),
  ended_at: z.string().nullable()
})

export type PrimarySessionRecord = {
  ownerId: string
  runId: string
  generation: number
  launchOperationId: string
  launchLedger: (typeof PRIMARY_SESSION_LEDGERS)[number] | null
  terminalHandle: string | null
  paneKey: string | null
  processIncarnation: string | null
  /** Only the sha256 of Orca's launch token is ever stored. */
  launchTokenSha256: string | null
  permissionMode: PrimarySessionPermissionMode
  requestedModel: string
  requestedEffort: (typeof AUTOPILOT_EFFORT_LEVELS)[number]
  state: PrimarySessionState
  receipt: Record<string, unknown> | null
  endReason: string | null
  startedAt: string
  updatedAt: string
  endedAt: string | null
}

export const PRIMARY_SESSION_COLUMNS = `owner_id, run_id, generation, launch_operation_id, launch_ledger,
  terminal_handle, pane_key, process_incarnation, launch_token_sha256, permission_mode, requested_model,
  requested_effort, state, receipt, end_reason, started_at, updated_at, ended_at`

function parseReceipt(text: string | null): Record<string, unknown> | null {
  return text === null
    ? null
    : parseStoredRow(ReceiptObjectSchema, JSON.parse(text), 'session receipt')
}

export function toPrimarySessionRecord(row: unknown): PrimarySessionRecord {
  const stored = parseStoredRow(RowSchema, row, 'primary session')
  return {
    ownerId: stored.owner_id,
    runId: stored.run_id,
    generation: stored.generation,
    launchOperationId: stored.launch_operation_id,
    launchLedger: stored.launch_ledger,
    terminalHandle: stored.terminal_handle,
    paneKey: stored.pane_key,
    processIncarnation: stored.process_incarnation,
    launchTokenSha256: stored.launch_token_sha256,
    permissionMode: stored.permission_mode,
    requestedModel: stored.requested_model,
    requestedEffort: stored.requested_effort,
    state: stored.state,
    receipt: parseReceipt(stored.receipt),
    endReason: stored.end_reason,
    startedAt: stored.started_at,
    updatedAt: stored.updated_at,
    endedAt: stored.ended_at
  }
}

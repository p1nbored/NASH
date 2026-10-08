import { z } from 'zod'
import type { OrchestrationDb } from '../orchestration/db'
import { RUN_MESSAGE_SOURCES } from '../orchestration/db/autopilot-message-schema-definition'
import { AutopilotIdSchema } from '../orchestration/db/autopilot-store-input'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import {
  getRunMessageStore,
  type RunMessageOutcome,
  type RunMessageRecord,
  type RunMessageState
} from '../orchestration/db/run-message-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { clockTimestamp, errorCodeOf, type PrimaryTerminalPort } from './primary-session-ports'
import {
  promoteVerifiedOwner,
  readPrimarySessionStatus,
  type PrimarySessionStatus
} from './primary-session-status'
import {
  flushHeldRunMessages,
  settleRunMessageSend,
  type LivePrimaryRead
} from './run-message-flush'
import {
  SYSTEM_RUN_MESSAGE_TIMERS,
  createKeyedSerializer,
  createRunFlushTimers,
  type RunMessageTimers
} from './run-message-scheduling'
import { sendRunMessageToPrimary } from './run-message-sender'
import { prepareRunMessageText, runMessageTextSha256 } from './run-message-text-checks'
import { readWorkflowRunController as readWorkflowRunOrigin } from './workflow-run-origin'
import { runMessageSourceAllowed } from './run-message-authority'
import { OrchestrationError } from '../orchestration/orchestration-error'

/** D-027: no hold cap or hold limit; a flush types held messages a page at a time, oldest first. */
export const RUN_MESSAGE_FLUSH_PAGE = 50
export const RUN_MESSAGE_FLUSH_INTERVAL_MS = 2_000
const IN_FLIGHT_SETTLE_LIMIT = 1000

const DeliveryInputSchema = z
  .object({
    runId: AutopilotIdSchema,
    source: z.enum(RUN_MESSAGE_SOURCES),
    sourceRequestId: AutopilotIdSchema,
    text: z.string()
  })
  .strict()
export type RunMessageDeliveryInput = z.infer<typeof DeliveryInputSchema>

export type RunMessageDeliveryResult = {
  readonly outcome: RunMessageOutcome
  /** A reason code: why it was refused or queued, or `agent_busy` for a message typed into a busy agent. */
  readonly reason: string | null
  /** Null when nothing was stored (invalid input, an unknown run, a reused request id). */
  readonly messageId: string | null
  readonly state: RunMessageState | null
  /** True when this request id was seen before; the first outcome is returned unchanged. */
  readonly duplicate: boolean
}

export type RunMessageDeliveryDeps = {
  readonly db: OrchestrationDb
  readonly terminal: Pick<
    PrimaryTerminalPort,
    | 'getTerminalAgentStatus'
    | 'getTerminalProcessIncarnation'
    | 'getTerminalHandleForPaneKey'
    | 'sendTerminalAgentPrompt'
  >
  readonly clock: { now(): number }
  /** A fresh id per terminal write, for Orca's prompt receipt. */
  readonly newRequestId: () => string
  readonly timers?: RunMessageTimers
  readonly onFlushError?: (code: string) => void
}

export type RunMessageDelivery = {
  deliver(input: RunMessageDeliveryInput): Promise<RunMessageDeliveryResult>
  /** Delivers held messages in order once no dialog is open; refuses them when the run or primary is gone. */
  flushHeld(runId: string): Promise<void>
  /** For an agent-status observer: a status change may have closed the dialog. */
  notifyPrimaryStatusChanged(runId: string): void
  /** Startup only: a message stored but not settled before a crash may sit in the composer; never retyped. */
  settleInterrupted(): number
  drain(runId: string): Promise<void>
  dispose(): void
}

function unstored(reason: string): RunMessageDeliveryResult {
  return { outcome: 'refused', reason, messageId: null, state: null, duplicate: false }
}

export function deliveryResultOf(
  record: RunMessageRecord,
  duplicate = false
): RunMessageDeliveryResult {
  return {
    outcome: record.outcome ?? 'queued',
    reason: record.reason,
    messageId: record.messageId,
    state: record.state,
    duplicate
  }
}

function liveRead(status: PrimarySessionStatus | null): LivePrimaryRead {
  if (status?.kind === 'live') {
    return status
  }
  return status?.kind === 'unverifiable' || status?.kind === 'starting'
    ? { kind: 'wait' }
    : { kind: 'gone' }
}

/** D-019: follow-up messages from dot or the desktop, typed into the run's primary terminal. */
export function createRunMessageDelivery(deps: RunMessageDeliveryDeps): RunMessageDelivery {
  const { db, terminal, clock } = deps
  const serializer = createKeyedSerializer()
  const flushTimers = createRunFlushTimers(
    deps.timers ?? SYSTEM_RUN_MESSAGE_TIMERS,
    RUN_MESSAGE_FLUSH_INTERVAL_MS
  )
  const messages = getRunMessageStore(db)
  const now = () => clockTimestamp(clock)

  async function readLivePrimary(runId: string): Promise<LivePrimaryRead> {
    const sessions = getPrimarySessionStore(db)
    const owner = sessions.findLiveByRun(runId)
    if (!owner) {
      return { kind: 'gone' }
    }
    const status = await readPrimarySessionStatus(terminal, owner)
    promoteVerifiedOwner(sessions, owner, status, now())
    return liveRead(status)
  }

  const flushContext = {
    db,
    clock,
    heldLimit: RUN_MESSAGE_FLUSH_PAGE,
    readLivePrimary,
    send: (handle: string, text: string, record: RunMessageRecord) =>
      sendRunMessageToPrimary(terminal, handle, text, deps.newRequestId(), () => {
        if (!runMessageSourceAllowed(db, record)) {
          throw new OrchestrationError(
            'run_not_owned_by_source',
            'Dot control of this run was revoked.'
          )
        }
      }),
    arm: (runId: string) => flushTimers.arm(runId, () => scheduleFlush(runId)),
    cancel: (runId: string) => flushTimers.cancel(runId)
  }

  function scheduleFlush(runId: string): void {
    void serializer
      .run(runId, () => flushHeldRunMessages(flushContext, runId))
      .catch((error) => {
        ;(deps.onFlushError ?? reportFlushError)(errorCodeOf(error))
      })
  }

  async function deliverLocked(input: RunMessageDeliveryInput): Promise<RunMessageDeliveryResult> {
    const textSha256 = runMessageTextSha256(input.text)
    const existing = messages.findBySource(input.source, input.sourceRequestId)
    if (existing) {
      const sameRequest = existing.runId === input.runId && existing.textSha256 === textSha256
      if (sameRequest && existing.state === 'held') {
        await flushHeldRunMessages(flushContext, input.runId)
        return deliveryResultOf(messages.get(existing.messageId) ?? existing, true)
      }
      return sameRequest ? deliveryResultOf(existing, true) : unstored('request_id_reused')
    }
    const run = getWorkflowRunStore(db).get(input.runId)
    if (!run) {
      return unstored('run_not_found')
    }
    const base = {
      runId: input.runId,
      source: input.source,
      sourceRequestId: input.sourceRequestId,
      textSha256,
      timestamp: now()
    }
    const refuse = (reason: string, storedText: string | null) =>
      deliveryResultOf(messages.recordRefused({ ...base, text: storedText, reason }))
    const prepared = prepareRunMessageText(input.text)
    if (!prepared.ok) {
      return refuse(prepared.reason, null)
    }
    // The text as it is stored and typed; terminal controls are neutralised (D-027 restriction 35).
    const { text } = prepared
    if (run.status !== 'active') {
      return refuse('run_not_active', text)
    }
    const origin = readWorkflowRunOrigin(db, input.runId)
    if (input.source === 'dot' && (!origin.found || origin.origin !== 'dot')) {
      return refuse('run_not_owned_by_source', text)
    }
    if (messages.countHeld(input.runId) > 0) {
      await flushHeldRunMessages(flushContext, input.runId)
    }
    const primary = await readLivePrimary(input.runId)
    if (primary.kind !== 'live') {
      return refuse('primary_not_live', text)
    }
    const held = messages.countHeld(input.runId)
    if (held > 0 || primary.activity === 'dialog_open') {
      const record = messages.recordHeld({
        ...base,
        text,
        reason: held > 0 ? 'behind_held_message' : 'dialog_open'
      })
      flushContext.arm(input.runId)
      return deliveryResultOf(record)
    }
    const record = messages.recordReceived({ ...base, text })
    const sent = await flushContext.send(primary.handle, text, record)
    return deliveryResultOf(settleRunMessageSend(flushContext, record, sent, primary.activity))
  }

  return {
    async deliver(input) {
      const parsed = DeliveryInputSchema.safeParse(input)
      if (!parsed.success) {
        return unstored('invalid_request')
      }
      return serializer.run(parsed.data.runId, () => deliverLocked(parsed.data))
    },
    flushHeld: (runId) => serializer.run(runId, () => flushHeldRunMessages(flushContext, runId)),
    notifyPrimaryStatusChanged(runId) {
      if (messages.countHeld(runId) > 0) {
        scheduleFlush(runId)
      }
    },
    settleInterrupted() {
      const interrupted = messages.listReceived(IN_FLIGHT_SETTLE_LIMIT)
      for (const record of interrupted) {
        messages.settle(record.messageId, {
          to: 'refused',
          firstOutcome: 'refused',
          reason: 'delivery_unconfirmed',
          timestamp: now()
        })
      }
      for (const runId of messages.listHeldRunIds()) {
        flushContext.arm(runId)
      }
      return interrupted.length
    },
    drain: (runId) => serializer.drain(runId),
    dispose: () => flushTimers.dispose()
  }
}

function reportFlushError(code: string): void {
  console.warn(`[run-messages] a held message flush failed: ${code}`)
}

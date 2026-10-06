import type { OrchestrationCompatibilityEvidence } from '../../../shared/orchestration-compatibility-evidence'
import {
  PERMISSION_RELAY_WAIT_MS,
  type PermissionRequestInput,
  type PermissionRequestResult,
  type PermissionWaitInput,
  type PermissionWaitResult,
  type WorkbenchPermissionAnswerInput,
  type WorkbenchPermissionAnswerResult,
  type WorkbenchPermissionDecisionView,
  type WorkbenchPermissionListInput,
  type WorkbenchPermissionListResult
} from '../../../shared/rpc-contract/permission-relay-params'
import type { OrchestrationDb } from '../orchestration/db'
import {
  getPermissionDecisionStore,
  type PermissionAnswerResult,
  type PermissionDecisionRecord,
  type PermissionDecisionStatus,
  type PermissionDecisionStore
} from '../orchestration/db/permission-decision-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { OrchestrationCompatibilityCallerAuthority } from '../runtime-terminal-contracts'
import { classifyPermissionAudience, type PermissionRelayInput } from './permission-audience'
import { requireDotMayAllow } from './permission-dot-allow'
import {
  listDesktopPermissionViews,
  listDotPermissionRecords,
  listPendingPrompts,
  toDesktopPermissionView
} from './permission-decision-views'
import { relayWaitOutcome } from './permission-hook-output'
import { buildPermissionSummary, isDesktopOnlyRecord } from './permission-redaction'
import {
  PERMISSION_RELAY_ERROR_CODES as CODES,
  appRunReadersIfPresent,
  resolvePermissionRelayCaller
} from './permission-relay-caller'
import { PermissionRelayWaiters } from './permission-relay-waiters'
import { PermissionTerminalObserver, type AgentStatusReader } from './permission-terminal-observer'

export type PermissionRelayDeps = {
  getDb(): OrchestrationDb
  /** `OrcaRuntimeService.verifyOrchestrationCompatibilityCaller` over the request's pane evidence. */
  verifyCaller(
    evidence: OrchestrationCompatibilityEvidence | undefined
  ): OrchestrationCompatibilityCallerAuthority | null
  readStatus: AgentStatusReader
  now(): number
  /** The app's own CLI name; commands that run it are desktop-only. */
  controlPlaneCommands: readonly string[]
  /** The app's data folders (userData); a prompt that touches them is desktop-only. */
  appDataDirectories?: readonly string[]
  reportError?(error: unknown): void
}

/** `closed`: the relay wait is over or no hook waits any more; the prompt is answered in the terminal. */
export type PermissionRelayAnswer =
  | PermissionAnswerResult
  | { outcome: 'closed'; record: PermissionDecisionRecord }

export type PermissionAnswerRequest = {
  decisionId: string
  decision: 'allow' | 'deny'
  decidedBy: 'dot' | 'desktop'
}

const TICK_INTERVAL_MS = 1_000
const RECHECK_MS = 1_000

const iso = (ms: number): string => new Date(ms).toISOString()

function reportByCode(error: unknown): void {
  const code = error instanceof OrchestrationError ? error.code : 'unexpected'
  console.warn('[permission-relay] maintenance failed:', code)
}

/**
 * The permission relay (D-016 §1.3 step 7, D-017). A prompt from a run's primary session becomes a
 * `permission_decisions` row that dot and the desktop may answer while the hook waits; the first
 * answer wins. With no answer the hook prints nothing, Claude Code shows its own dialog, and the
 * terminal observer closes the row as `answered_in_terminal` once that dialog is answered.
 */
export class PermissionRelayService {
  private readonly waiters = new PermissionRelayWaiters()
  /** Pending prompts this service tracks, with their relay deadline in epoch ms. */
  private readonly known = new Map<string, number>()
  private readonly observer: PermissionTerminalObserver
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking = false

  constructor(private readonly deps: PermissionRelayDeps) {
    this.observer = new PermissionTerminalObserver({
      readStatus: deps.readStatus,
      sink: {
        isPending: (decisionId) => this.storeIfPresent()?.get(decisionId)?.status === 'pending',
        markAnsweredInTerminal: (decisionId) => this.closeInTerminal(decisionId)
      }
    })
  }

  request(
    evidence: OrchestrationCompatibilityEvidence | undefined,
    input: PermissionRequestInput
  ): PermissionRequestResult {
    const db = this.deps.getDb()
    const caller = resolvePermissionRelayCaller(db, this.deps.verifyCaller(evidence))
    const relayInput: PermissionRelayInput = {
      toolName: input.toolName,
      agentId: input.agentId,
      cwd: input.cwd,
      toolInput: input.toolInput
    }
    const audience = classifyPermissionAudience(
      relayInput,
      this.deps.controlPlaneCommands,
      this.deps.appDataDirectories
    )
    if (audience === 'terminal_only') {
      return { outcome: 'not_relayed', reason: 'terminal_only_tool' }
    }
    const built = buildPermissionSummary(relayInput, audience === 'desktop_only')
    if (!built) {
      throw new OrchestrationError(
        CODES.summaryRefused,
        'The prompt could not be summarized safely, so it stays in the terminal. No effects were applied.',
        { effectsApplied: false }
      )
    }
    const now = this.deps.now()
    const record = getPermissionDecisionStore(db).create({
      runId: caller.runId,
      ownerId: caller.ownerId,
      agentId: input.agentId,
      toolName: input.toolName,
      summary: built.summary,
      requestSha256: input.requestSha256,
      deadlineAt: iso(now + Math.min(PERMISSION_RELAY_WAIT_MS, input.waitBudgetMs)),
      timestamp: iso(now)
    })
    this.known.set(record.decisionId, Date.parse(record.deadlineAt))
    this.waiters.open(record.decisionId, now)
    this.observer.watch(record.decisionId, caller.terminalHandle)
    return { outcome: 'relayed', decisionId: record.decisionId, deadlineAt: record.deadlineAt }
  }

  /** One long-poll slice for the hook that raised the prompt; never longer than `waitMs`. */
  async wait(
    evidence: OrchestrationCompatibilityEvidence | undefined,
    input: PermissionWaitInput,
    signal?: AbortSignal
  ): Promise<PermissionWaitResult> {
    const db = this.deps.getDb()
    const caller = resolvePermissionRelayCaller(db, this.deps.verifyCaller(evidence))
    const store = getPermissionDecisionStore(db)
    const record = store.get(input.decisionId)
    if (!record || record.ownerId !== caller.ownerId) {
      throw new OrchestrationError(CODES.notFound, 'The permission prompt was not found.', {
        effectsApplied: false
      })
    }
    const sliceEnd = this.deps.now() + input.waitMs
    const deadline = Date.parse(record.deadlineAt)
    this.waiters.enter(input.decisionId, this.deps.now())
    let final = false
    try {
      for (;;) {
        const settled = relayWaitOutcome(store.get(input.decisionId), this.deps.now())
        if (settled) {
          final = true
          return settled
        }
        const now = this.deps.now()
        if (now >= sliceEnd || signal?.aborted) {
          return { state: 'pending' }
        }
        const until = Math.min(sliceEnd, deadline, now + RECHECK_MS)
        await this.waiters.waitForChange(input.decisionId, until - now, signal)
      }
    } finally {
      // Why: after a final outcome no hook waits for this prompt again, so its entry can go.
      if (final) {
        this.waiters.forget(input.decisionId)
      } else {
        this.waiters.leave(input.decisionId, this.deps.now())
      }
    }
  }

  /** The CAS port for dot (D4) and the desktop. dot is refused on a desktop-only prompt, with no effect. */
  answer(request: PermissionAnswerRequest): PermissionRelayAnswer {
    const store = this.storeIfPresent()
    const record = store?.get(request.decisionId)
    if (!store || !record) {
      return { outcome: 'not_found' }
    }
    if (request.decidedBy === 'dot' && isDesktopOnlyRecord(record)) {
      throw new OrchestrationError(
        CODES.desktopOnly,
        'This permission prompt can only be answered in the app. No effects were applied.',
        { effectsApplied: false }
      )
    }
    if (record.status !== 'pending') {
      return { outcome: 'already_decided', record }
    }
    const now = this.deps.now()
    // Why: a late answer must not reach the store, whose lazy expiry would end the terminal's turn.
    if (!this.isAnswerable(record, now)) {
      return { outcome: 'closed', record }
    }
    // RG7: checked right before the only write, so a refused dot allow has no effect.
    if (request.decidedBy === 'dot' && request.decision === 'allow') {
      requireDotMayAllow(this.deps.getDb(), record)
    }
    const result = store.answer({
      decisionId: request.decisionId,
      decision: request.decision === 'allow' ? 'allowed' : 'denied',
      decidedBy: request.decidedBy,
      timestamp: iso(now)
    })
    this.waiters.notify(request.decisionId)
    return result
  }

  answerFromDot(input: WorkbenchPermissionAnswerInput): PermissionRelayAnswer {
    return this.answer({ ...input, decidedBy: 'dot' })
  }

  answerFromDesktop(input: WorkbenchPermissionAnswerInput): WorkbenchPermissionAnswerResult {
    const result = this.answer({ ...input, decidedBy: 'desktop' })
    return result.outcome === 'not_found'
      ? { outcome: 'not_found', decision: null }
      : { outcome: result.outcome, decision: this.desktopView(result.record) }
  }

  /** Prompts dot may see for one run: desktop-only prompts are never offered to it. */
  listForDot(
    runId: string,
    options: { statuses?: readonly PermissionDecisionStatus[]; limit: number }
  ): PermissionDecisionRecord[] {
    return listDotPermissionRecords(this.deps.getDb(), runId, options)
  }

  /** Every prompt of the named run or of all open app runs, oldest first. */
  listForDesktop(input: WorkbenchPermissionListInput): WorkbenchPermissionListResult {
    const now = this.deps.now()
    return listDesktopPermissionViews(this.deps.getDb(), input, (record) =>
      this.isAnswerable(record, now)
    )
  }

  /** Observes the panes of pending prompts, then expires what nobody can answer any more. */
  async tick(): Promise<void> {
    if (this.ticking || this.known.size === 0) {
      return
    }
    this.ticking = true
    try {
      await this.observer.poll()
      this.sweep()
    } catch (error) {
      ;(this.deps.reportError ?? reportByCode)(error)
    } finally {
      this.ticking = false
    }
  }

  /** Picks up prompts an earlier app session left pending, then observes on a timer. */
  start(): void {
    if (this.timer) {
      return
    }
    this.adoptPending()
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS)
    this.timer.unref?.()
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private isAnswerable(record: PermissionDecisionRecord, now: number): boolean {
    return (
      record.status === 'pending' &&
      now < Date.parse(record.deadlineAt) &&
      this.waiters.isWaiting(record.decisionId, now)
    )
  }

  private desktopView(record: PermissionDecisionRecord): WorkbenchPermissionDecisionView {
    return toDesktopPermissionView(record, this.isAnswerable(record, this.deps.now()))
  }

  private storeIfPresent(): PermissionDecisionStore | null {
    const db = this.deps.getDb()
    return appRunReadersIfPresent(db) ? getPermissionDecisionStore(db) : null
  }

  private closeInTerminal(decisionId: string): void {
    this.storeIfPresent()?.markAnsweredInTerminal({ decisionId, timestamp: iso(this.deps.now()) })
    this.waiters.notify(decisionId)
    this.forget(decisionId)
  }

  private sweep(): void {
    const store = this.storeIfPresent()
    if (!store) {
      return
    }
    for (const decisionId of this.known.keys()) {
      if (store.get(decisionId)?.status !== 'pending') {
        this.forget(decisionId)
      }
    }
    const now = this.deps.now()
    for (const [decisionId, deadline] of this.known) {
      // Why: a prompt whose dialog is still open stays pending until the user answers it in the terminal.
      if (deadline > now || this.observer.holds(decisionId)) {
        continue
      }
      if (store.expire(decisionId, iso(now))) {
        this.waiters.notify(decisionId)
        this.forget(decisionId)
      }
    }
  }

  private forget(decisionId: string): void {
    this.known.delete(decisionId)
    this.waiters.forget(decisionId)
    this.observer.unwatch(decisionId)
  }

  private adoptPending(): void {
    for (const prompt of listPendingPrompts(this.deps.getDb())) {
      this.known.set(prompt.decisionId, prompt.deadlineMs)
      if (prompt.terminalHandle) {
        this.observer.watch(prompt.decisionId, prompt.terminalHandle)
      }
    }
  }
}

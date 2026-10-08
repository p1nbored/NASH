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
import {
  getPermissionDecisionStore,
  type PermissionDecisionRecord,
  type PermissionDecisionStatus,
  type PermissionDecisionStore
} from '../orchestration/db/permission-decision-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { classifyPermissionAudience, type PermissionRelayInput } from './permission-audience'
import { requireDotMayAllow } from './permission-dot-allow'
import {
  listDesktopPermissionViews,
  listDotPermissionRecords,
  listPendingPrompts,
  toDesktopPermissionView
} from './permission-decision-views'
import { waitForPermissionDecision } from './permission-relay-wait'
import {
  listPrimaryPermissionRecords,
  requirePrimaryPermissionReview
} from './permission-primary-review'
import { buildPermissionSummary, isDesktopOnlyRecord } from './permission-redaction'
import {
  PERMISSION_RELAY_ERROR_CODES as CODES,
  appRunReadersIfPresent,
  resolvePermissionRelayCaller
} from './permission-relay-caller'
import { PermissionRelayWaiters } from './permission-relay-waiters'
import { PermissionTerminalObserver } from './permission-terminal-observer'
import { isPermissionSourceLive } from './permission-source'

import type {
  PermissionRelayDeps,
  PermissionRelayAnswer,
  PermissionAnswerRequest
} from './permission-relay-types'
export type {
  PermissionRelayDeps,
  PermissionRelayAnswer,
  PermissionAnswerRequest
} from './permission-relay-types'

const TICK_INTERVAL_MS = 1_000

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
  private readonly sources = new Map<string, { handle: string; incarnation: string | null }>()
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
    const caller = resolvePermissionRelayCaller(db, this.deps.verifyCaller(evidence), true)
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
    const existing = getPermissionDecisionStore(db)
      .listPending(caller.runId, 200)
      .find(
        (record) =>
          record.ownerId === caller.ownerId &&
          record.agentId === (caller.dispatchId ?? null) &&
          record.requestSha256 === input.requestSha256 &&
          record.toolName === input.toolName &&
          record.summary === built.summary &&
          this.isAnswerable(record, now)
      )
    if (existing) {
      return {
        outcome: 'relayed',
        decisionId: existing.decisionId,
        deadlineAt: existing.deadlineAt
      }
    }
    const record = getPermissionDecisionStore(db).create({
      runId: caller.runId,
      ownerId: caller.ownerId,
      agentId: caller.dispatchId ?? null,
      toolName: input.toolName,
      summary: built.summary,
      requestSha256: input.requestSha256,
      deadlineAt: iso(now + Math.min(PERMISSION_RELAY_WAIT_MS, input.waitBudgetMs)),
      timestamp: iso(now)
    })
    this.known.set(record.decisionId, Date.parse(record.deadlineAt))
    this.sources.set(record.decisionId, {
      handle: caller.terminalHandle,
      incarnation: caller.processIncarnation
    })
    this.waiters.open(record.decisionId, now)
    this.observer.watch(record.decisionId, caller.terminalHandle)
    if (caller.dispatchId) {
      this.deps.notifyPrimary?.(record)
    }
    return { outcome: 'relayed', decisionId: record.decisionId, deadlineAt: record.deadlineAt }
  }

  async wait(
    evidence: OrchestrationCompatibilityEvidence | undefined,
    input: PermissionWaitInput,
    signal?: AbortSignal
  ): Promise<PermissionWaitResult> {
    const db = this.deps.getDb()
    return waitForPermissionDecision(
      {
        db,
        caller: resolvePermissionRelayCaller(db, this.deps.verifyCaller(evidence), true),
        now: this.deps.now,
        waiters: this.waiters,
        isSourceLive: (record) => this.isSourceLive(record)
      },
      input,
      signal
    )
  }
  /** The CAS port for dot (D4) and the desktop. dot is refused on a desktop-only prompt, with no effect. */
  answer(request: PermissionAnswerRequest): PermissionRelayAnswer {
    const store = this.storeIfPresent()
    const record = store?.get(request.decisionId)
    if (!store || !record) {
      return { outcome: 'not_found' }
    }
    if (
      request.decidedBy !== 'desktop' &&
      (request.decidedBy === 'primary' || request.decision === 'allow') &&
      isDesktopOnlyRecord(record)
    ) {
      throw new OrchestrationError(
        CODES.desktopOnly,
        'This permission prompt can only be answered in the app. No effects were applied.',
        { effectsApplied: false }
      )
    }
    if (request.decidedBy === 'dot' && record.agentId !== null && !isDesktopOnlyRecord(record)) {
      throw new OrchestrationError(
        CODES.callerRefused,
        'The primary agent reviews child permissions.',
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

  listForPrimary(
    evidence: OrchestrationCompatibilityEvidence | undefined
  ): WorkbenchPermissionListResult {
    return {
      decisions: listPrimaryPermissionRecords(
        this.deps.getDb(),
        this.deps.verifyCaller(evidence)
      ).map((record) => this.desktopView(record))
    }
  }

  answerFromPrimary(
    evidence: OrchestrationCompatibilityEvidence | undefined,
    input: WorkbenchPermissionAnswerInput
  ): WorkbenchPermissionAnswerResult {
    requirePrimaryPermissionReview(this.deps.getDb(), this.deps.verifyCaller(evidence), input)
    const result = this.answer({ ...input, decidedBy: 'primary' })
    return result.outcome === 'not_found'
      ? { outcome: 'not_found', decision: null }
      : { outcome: result.outcome, decision: this.desktopView(result.record) }
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
      this.waiters.isWaiting(record.decisionId, now) &&
      this.isSourceLive(record)
    )
  }

  private isSourceLive(record: PermissionDecisionRecord): boolean {
    return isPermissionSourceLive(
      this.deps.getDb(),
      record,
      this.sources.get(record.decisionId),
      this.deps.readIncarnation
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
    for (const [decisionId, deadline] of this.known) {
      // A hook may still consume a settled answer after the maintenance tick.
      if (store.get(decisionId)?.status !== 'pending' && deadline <= this.deps.now()) {
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
    this.sources.delete(decisionId)
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

import type { OrchestrationDb } from './orchestration-db'
import {
  MarkRunningInputSchema,
  MarkStartOutcomeInputSchema,
  SettleClaimInputSchema,
  SettleFailureInputSchema,
  type AppAttemptStartInput,
  type AppAttemptView,
  type AttemptNotice,
  type MarkRunningInput,
  type MarkStartOutcomeInput,
  type SettleClaimInput,
  type SettleFailureInput
} from './app-attempt-input'
import { expectAttempt, loadAttempt, readAttemptView, type LoadedAttempt } from './app-attempt-load'
import { fileAttemptNotice, recordClaimFact, recordReportFact } from './app-attempt-orca-facts'
import {
  failAttemptInOrca,
  failStartInOrca,
  readyWorkerInOrca,
  recordClaimInOrca
} from './app-attempt-orca-writes'
import { listAwaitingValidation, type AwaitingValidationEntry } from './app-attempt-queries'
import { startAppAttempt } from './app-attempt-start'
import { APP_ATTEMPT_STAGES } from './app-attempt-stages'
import { assertNoSecretLikeText } from './autopilot-json-column'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import { parseAutopilotInput, runAutopilotWrite } from './autopilot-store-input'
import { getTaskSpecStore, type TaskSpecStore } from './task-spec-store'

export type { AppAttemptStartInput, AppAttemptView } from './app-attempt-input'
export type { AwaitingValidationEntry } from './app-attempt-queries'

const stores = new WeakMap<OrchestrationDb, AppAttemptSettlement>()

export function getAppAttemptSettlement(owner: OrchestrationDb): AppAttemptSettlement {
  let settlement = stores.get(owner)
  if (!settlement) {
    settlement = new AppAttemptSettlement(owner)
    stores.set(owner, settlement)
  }
  return settlement
}

function checkedNotice(notice: AttemptNotice | undefined): AttemptNotice | null {
  if (notice) {
    assertNoSecretLikeText([notice.subject, notice.body], 'notice')
  }
  return notice ?? null
}

/**
 * Moves an in-session attempt's Orca Dispatch, worker and Task together in one transaction.
 * A claim of success never completes a task: it leaves the task
 * blocked beside an open Dispatch until a validator decides (app-attempt-validation-outcome).
 */
export class AppAttemptSettlement {
  private readonly specs: TaskSpecStore

  constructor(private readonly owner: OrchestrationDb) {
    ensureAutopilotRuntimeSchema(owner.db)
    this.specs = getTaskSpecStore(owner)
  }

  start(input: AppAttemptStartInput): AppAttemptView {
    return startAppAttempt(this.owner, this.specs, input)
  }

  /** The in-session worker is declared ready: Orca's Dispatch opens. */
  markRunning(input: MarkRunningInput): AppAttemptView {
    const params = parseAutopilotInput(MarkRunningInputSchema, input, 'attempt running')
    return this.write('autopilot_attempt_running', params.dispatchId, (attempt) => {
      expectAttempt(attempt, {
        dispatch: ['pending'],
        worker: ['starting'],
        task: ['dispatched']
      })
      readyWorkerInOrca(this.owner, attempt, params.timestamp)
      return null
    })
  }

  /** Nothing ran: the attempt and its task fail, and the task can be retried from this attempt. */
  markStartFailed(input: MarkStartOutcomeInput): AppAttemptView {
    const params = parseAutopilotInput(MarkStartOutcomeInputSchema, input, 'attempt start outcome')
    const notice = checkedNotice(params.notice)
    return this.write('autopilot_attempt_start_failed', params.dispatchId, (attempt) => {
      expectAttempt(attempt, {
        dispatch: ['pending'],
        worker: ['starting'],
        task: ['dispatched']
      })
      failStartInOrca(this.owner, attempt, params.reason, params.timestamp)
      return notice && { notice, name: 'start_failed', priority: 'high' }
    })
  }

  /** The session reports it is done. The task waits, blocked, for a validator. */
  settleClaim(input: SettleClaimInput): AppAttemptView {
    const params = parseAutopilotInput(SettleClaimInputSchema, input, 'attempt claim')
    const notice = checkedNotice(params.notice)
    return this.write('autopilot_attempt_claim', params.dispatchId, (attempt) => {
      this.requireRunning(attempt)
      recordClaimInOrca(this.owner, attempt, params.timestamp)
      recordClaimFact(this.owner, attempt.dispatch, params.timestamp)
      return notice && { notice, name: 'claimed', priority: 'normal' }
    })
  }

  /** A failed session report fails the attempt and its task. */
  settleFailure(input: SettleFailureInput): AppAttemptView {
    const params = parseAutopilotInput(SettleFailureInputSchema, input, 'attempt failure')
    const notice = checkedNotice(params.notice)
    return this.write('autopilot_attempt_failure', params.dispatchId, (attempt) => {
      this.requireRunning(attempt)
      failAttemptInOrca(this.owner, attempt, {
        reason: params.reason,
        stage: APP_ATTEMPT_STAGES.executorFailed,
        resultText: `The attempt failed: ${params.reason}.`,
        timestamp: params.timestamp
      })
      recordReportFact(
        this.owner,
        attempt.dispatch,
        { outcome: 'failed', reportId: `${attempt.dispatch.id}:failure` },
        params.timestamp
      )
      return notice && { notice, name: params.outcome, priority: 'high' }
    })
  }

  /** Claimed attempts whose task waits for a validator, oldest first; each carries its validation, if opened. */
  listAwaitingValidation(limit: number): AwaitingValidationEntry[] {
    return listAwaitingValidation(this.owner.db, limit)
  }

  /** The waiting attempts whose validation was inconclusive: decisions for the user or dot. */
  listInconclusiveValidations(limit: number): AwaitingValidationEntry[] {
    return listAwaitingValidation(this.owner.db, limit, { onlyInconclusive: true })
  }

  /** A claim or failure applies only while the in-session attempt is running. */
  private requireRunning(attempt: LoadedAttempt): void {
    expectAttempt(attempt, {
      dispatch: ['dispatched'],
      worker: ['ready'],
      stage: [APP_ATTEMPT_STAGES.executorRunning],
      task: ['dispatched']
    })
  }

  /** One transaction: load, check, write, and return the view; a notice, if asked for, is filed inside it. */
  private write(
    savepoint: string,
    dispatchId: string,
    change: (
      attempt: LoadedAttempt
    ) => null | { notice: AttemptNotice; name: string; priority: 'normal' | 'high' }
  ): AppAttemptView {
    return runAutopilotWrite(this.owner.db, savepoint, () => {
      const attempt = loadAttempt(this.owner, dispatchId)
      const filing = change(attempt)
      const message = filing
        ? fileAttemptNotice(this.owner, attempt.dispatch, filing.notice, filing)
        : null
      return readAttemptView(this.owner, dispatchId, message)
    })
  }
}

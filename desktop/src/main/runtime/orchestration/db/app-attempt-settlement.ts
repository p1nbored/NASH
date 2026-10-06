import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import {
  MarkRunningInputSchema,
  MarkStartOutcomeInputSchema,
  SettleClaimInputSchema,
  SettleFailureInputSchema,
  SettleStopInputSchema,
  refuseProcessEvidenceForInSession,
  type AppAttemptStartInput,
  type AppAttemptView,
  type AttemptNotice,
  type MarkRunningInput,
  type MarkStartOutcomeInput,
  type SettleClaimInput,
  type SettleFailureInput,
  type SettleStopInput
} from './app-attempt-input'
import {
  expectAttempt,
  loadAttempt,
  readAttemptView,
  requireExecutorRecord,
  type LoadedAttempt
} from './app-attempt-load'
import { fileAttemptNotice, recordClaimFact, recordReportFact } from './app-attempt-orca-facts'
import {
  failAttemptInOrca,
  failStartInOrca,
  readyWorkerInOrca,
  recordClaimInOrca,
  startUnknownInOrca
} from './app-attempt-orca-writes'
import {
  listAwaitingValidation,
  listUnrecordedStarts,
  type AwaitingValidationEntry,
  type UnrecordedStart
} from './app-attempt-queries'
import { startAppAttempt } from './app-attempt-start'
import { applyStop } from './app-attempt-stop'
import { APP_ATTEMPT_STAGES } from './app-attempt-stages'
import { assertNoSecretLikeText } from './autopilot-json-column'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import { parseAutopilotInput, runAutopilotWrite } from './autopilot-store-input'
import {
  applyExecutorTransition,
  getExecutorProcessStore,
  type ExecutorProcessStore
} from './executor-process-store'
import { getTaskSpecStore, type TaskSpecStore } from './task-spec-store'

export type { AppAttemptStartInput, AppAttemptView } from './app-attempt-input'
export type { AwaitingValidationEntry } from './app-attempt-queries'

const PROCESS_EVIDENCE = [
  'exitCode',
  'tree',
  'lastMessage',
  'verdict',
  'usage',
  'threadId'
] as const
const NEVER_RAN = { verdict: 'exited', method: 'not_started' } as const

const stores = new WeakMap<OrchestrationDb, AppAttemptSettlement>()

export function getAppAttemptSettlement(owner: OrchestrationDb): AppAttemptSettlement {
  let settlement = stores.get(owner)
  if (!settlement) {
    settlement = new AppAttemptSettlement(owner)
    stores.set(owner, settlement)
  }
  return settlement
}

function invalid(fields: string[]): OrchestrationError {
  return new OrchestrationError('autopilot_invalid_input', 'Invalid attempt settlement.', {
    fields
  })
}

function checkedNotice(notice: AttemptNotice | undefined): AttemptNotice | null {
  if (notice) {
    assertNoSecretLikeText([notice.subject, notice.body], 'notice')
  }
  return notice ?? null
}

/**
 * Moves an attempt's Orca Dispatch, worker and Task together with the executor row, in one
 * transaction each. An executor's claim of success never completes a task: it leaves the task
 * blocked beside an open Dispatch until a validator decides (app-attempt-validation-outcome).
 */
export class AppAttemptSettlement {
  private readonly executors: ExecutorProcessStore
  private readonly specs: TaskSpecStore

  constructor(private readonly owner: OrchestrationDb) {
    ensureAutopilotRuntimeSchema(owner.db)
    this.executors = getExecutorProcessStore(owner)
    this.specs = getTaskSpecStore(owner)
  }

  start(input: AppAttemptStartInput): AppAttemptView {
    return startAppAttempt(this.owner, { executors: this.executors, specs: this.specs }, input)
  }

  /** The process is up (or the in-session worker is declared ready): Orca's Dispatch opens. */
  markRunning(input: MarkRunningInput): AppAttemptView {
    const params = parseAutopilotInput(MarkRunningInputSchema, input, 'attempt running')
    return this.write('autopilot_attempt_running', params.dispatchId, (attempt) => {
      requireExecutorRecord(attempt)
      expectAttempt(attempt, {
        dispatch: ['pending'],
        worker: ['starting'],
        task: ['dispatched'],
        executor: ['starting']
      })
      if (attempt.kind === 'in_session') {
        refuseProcessEvidenceForInSession(params, ['executableEvidence', 'threadId'])
      } else if (!params.executableEvidence) {
        throw invalid(['executableEvidence'])
      } else {
        applyExecutorTransition(this.owner.db, {
          dispatchId: params.dispatchId,
          from: 'starting',
          to: 'running',
          executableEvidence: params.executableEvidence,
          threadId: params.threadId,
          timestamp: params.timestamp
        })
      }
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
        task: ['dispatched'],
        executor: ['starting'],
        executorMayBeMissing: true
      })
      if (attempt.executor) {
        applyExecutorTransition(this.owner.db, {
          dispatchId: params.dispatchId,
          from: 'starting',
          to: 'failed',
          tree: NEVER_RAN,
          verdict: { ...params.verdict, reason: params.reason },
          timestamp: params.timestamp
        })
      }
      failStartInOrca(this.owner, attempt, params.reason, params.timestamp)
      return notice && { notice, name: 'start_failed', priority: 'high' }
    })
  }

  /** A process may or may not exist: the task blocks and nothing is retried until the user decides. */
  markStartUnknown(input: MarkStartOutcomeInput): AppAttemptView {
    const params = parseAutopilotInput(MarkStartOutcomeInputSchema, input, 'attempt start outcome')
    const notice = checkedNotice(params.notice)
    return this.write('autopilot_attempt_start_unknown', params.dispatchId, (attempt) => {
      requireExecutorRecord(attempt)
      expectAttempt(attempt, {
        dispatch: ['pending'],
        worker: ['starting'],
        task: ['dispatched'],
        executor: ['starting']
      })
      if (attempt.executor) {
        applyExecutorTransition(this.owner.db, {
          dispatchId: params.dispatchId,
          from: 'starting',
          to: 'start_unknown',
          verdict: { ...params.verdict, reason: params.reason },
          timestamp: params.timestamp
        })
      }
      startUnknownInOrca(this.owner, attempt, params.reason, params.timestamp)
      return notice && { notice, name: 'start_unknown', priority: 'high' }
    })
  }

  /** The executor says it is done. The task waits, blocked, for a validator; it is never completed here. */
  settleClaim(input: SettleClaimInput): AppAttemptView {
    const params = parseAutopilotInput(SettleClaimInputSchema, input, 'attempt claim')
    const notice = checkedNotice(params.notice)
    return this.write('autopilot_attempt_claim', params.dispatchId, (attempt) => {
      this.requireRunning(attempt)
      if (attempt.kind === 'in_session') {
        refuseProcessEvidenceForInSession(params, PROCESS_EVIDENCE)
      } else {
        applyExecutorTransition(this.owner.db, {
          dispatchId: params.dispatchId,
          from: 'running',
          to: 'completed',
          exitCode: params.exitCode,
          tree: params.tree,
          lastMessage: params.lastMessage,
          verdict: params.verdict,
          usage: params.usage,
          threadId: params.threadId,
          timestamp: params.timestamp
        })
      }
      recordClaimInOrca(this.owner, attempt, params.timestamp)
      recordClaimFact(this.owner, attempt.dispatch, params.timestamp)
      return notice && { notice, name: 'claimed', priority: 'normal' }
    })
  }

  /** The executor failed or its route blocked it: the attempt and its task fail, with the evidence kept. */
  settleFailure(input: SettleFailureInput): AppAttemptView {
    const params = parseAutopilotInput(SettleFailureInputSchema, input, 'attempt failure')
    const notice = checkedNotice(params.notice)
    return this.write('autopilot_attempt_failure', params.dispatchId, (attempt) => {
      this.requireRunning(attempt)
      if (attempt.kind === 'in_session') {
        refuseProcessEvidenceForInSession(params, PROCESS_EVIDENCE)
        if (params.outcome !== 'failed') {
          throw invalid(['outcome'])
        }
      } else {
        applyExecutorTransition(this.owner.db, {
          dispatchId: params.dispatchId,
          from: 'running',
          to: params.outcome,
          exitCode: params.exitCode,
          tree: params.tree,
          lastMessage: params.lastMessage,
          verdict: { ...params.verdict, reason: params.reason },
          usage: params.usage,
          threadId: params.threadId,
          timestamp: params.timestamp
        })
      }
      failAttemptInOrca(this.owner, attempt, {
        reason: params.reason,
        stage:
          params.outcome === 'blocked'
            ? APP_ATTEMPT_STAGES.executorBlocked
            : APP_ATTEMPT_STAGES.executorFailed,
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

  /** A stop is stopped only with proof of exit; otherwise it stays unknown and the Dispatch stays open. */
  settleStop(input: SettleStopInput): AppAttemptView {
    const params = parseAutopilotInput(SettleStopInputSchema, input, 'attempt stop')
    const notice = checkedNotice(params.notice)
    return this.write('autopilot_attempt_stop', params.dispatchId, (attempt) => {
      applyStop(this.owner, attempt, params)
      const name = params.stopVerdict === 'exited' ? 'stopped' : 'stop_unknown'
      return notice && { notice, name, priority: 'normal' }
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

  /** Starts whose executor row was never written (a crash between the two writes): no process can exist. */
  listUnrecordedStarts(limit: number): UnrecordedStart[] {
    return listUnrecordedStarts(this.owner.db, limit)
  }

  /** A claim or failure applies to a running attempt: the process is up and no claim is on record. */
  private requireRunning(attempt: LoadedAttempt): void {
    requireExecutorRecord(attempt)
    expectAttempt(attempt, {
      dispatch: ['dispatched'],
      worker: ['ready'],
      stage: [APP_ATTEMPT_STAGES.executorRunning],
      task: ['dispatched'],
      executor: ['running']
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
      const attempt = loadAttempt(this.owner, this.executors, dispatchId)
      const filing = change(attempt)
      const message = filing
        ? fileAttemptNotice(this.owner, attempt.dispatch, filing.notice, filing)
        : null
      return readAttemptView(this.owner, this.executors, dispatchId, message)
    })
  }
}

import type {
  ValidationDecisionChoice,
  WorkbenchValidationDecideResult,
  WorkbenchValidationListDecisionsResult
} from '../../../shared/rpc-contract/workbench-validation-decision-params'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import type { TaskValidationRecord } from '../orchestration/db/task-validation-record'
import { getTaskValidationStore } from '../orchestration/db/task-validation-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { MessageRow } from '../orchestration/types'
import type { AttemptWorktree } from '../task-execution/attempt-worktree'
import type { WorktreeChangeFacts } from '../task-execution/task-result-notice'
import { readWorkflowRunOrigin, type WorkflowRunOrigin } from '../workflow-run/workflow-run-origin'
import type { AttemptWorktreeChangesReader } from './attempt-worktree-changes'
import { createValidationDecisionPort } from './task-validation-port'
import {
  buildDecisionNotice,
  decisionResultSummary,
  type ValidationDecider
} from './validation-decision-notice'
import { createDecisionViewReader } from './validation-decision-view'

/**
 * The one place an inconclusive validation is resolved (architecture section 9): the user from the
 * desktop, or dot for a run dot started. The primary session has no route here. Each decision files
 * a notice for the primary: merge a waived write task's branch, leave a rejected one for inspection.
 */
export type ValidationDecisionService = {
  listPending(input: ListPendingInput): WorkbenchValidationListDecisionsResult
  /** Async because a waive reads git in the attempt's own worktree before its notice is filed. */
  decide(input: DecideInput): Promise<WorkbenchValidationDecideResult>
}

export type ListPendingInput = {
  readonly limit: number
  /** Only runs of this origin; dot passes 'dot' so it sees only the runs it started. */
  readonly origin?: WorkflowRunOrigin
}

export type DecideInput = {
  readonly validationId: string
  readonly decision: ValidationDecisionChoice
  /** Fixed by the calling endpoint, never taken from the wire. */
  readonly by: ValidationDecider
}

export type ValidationDecisionServiceDeps = {
  readonly owner: OrchestrationDb
  readonly now?: () => Date
  /** Wakes the run's mailbox readers, as `runtime.notifyMessageArrived(to_handle, type)` does. */
  readonly announce?: (message: MessageRow) => void
  /** Who started a run; tests inject it, production reads the intake records. */
  readonly readOrigin?: (runId: string) => WorkflowRunOrigin
  /** Git facts of a waived attempt's own worktree; absent, the notice states none and asks for a check. */
  readonly readWorktreeChanges?: AttemptWorktreeChangesReader
}

/** The store's own bound; an origin filter scans this far so a filtered page is still full. */
const ORIGIN_SCAN_LIMIT = 1000
const UNREAD: WorktreeChangeFacts = { readable: false }

function conflict(message: string): OrchestrationError {
  return new OrchestrationError('autopilot_validation_conflict', message)
}

export function createValidationDecisionService(
  deps: ValidationDecisionServiceDeps
): ValidationDecisionService {
  const { owner } = deps
  const port = createValidationDecisionPort(owner)
  const validations = getTaskValidationStore(owner)
  const views = createDecisionViewReader(owner)
  const now = deps.now ?? (() => new Date())
  const originOf =
    deps.readOrigin ??
    ((runId: string): WorkflowRunOrigin => {
      const read = readWorkflowRunOrigin(owner, runId)
      return read.found ? read.origin : 'unknown'
    })
  const readChanges = async (worktree: AttemptWorktree): Promise<WorktreeChangeFacts> => {
    try {
      return (await deps.readWorktreeChanges?.(worktree)) ?? UNREAD
    } catch {
      return UNREAD
    }
  }

  /** The validation and its run, once the decider may decide it; the store re-checks inside its write. */
  const decidable = (
    validationId: string,
    by: ValidationDecider
  ): { validation: TaskValidationRecord; runId: string } => {
    const validation = validations.get(validationId)
    if (!validation) {
      throw new OrchestrationError(
        'autopilot_validation_not_found',
        'The validation was not found.'
      )
    }
    // Why here: the store also lets a pending validation be waived; a settled one it refuses itself.
    if (validation.verdict === 'pending') {
      throw conflict('The validation has no result yet, so there is nothing to decide.')
    }
    const runId = owner.getDispatchContextById(validation.dispatchId)?.run_id
    if (!runId) {
      throw new OrchestrationError('autopilot_recovery_required', 'The attempt rows disappeared.')
    }
    if (by === 'dot' && originOf(runId) !== 'dot') {
      throw new OrchestrationError(
        'autopilot_validation_decision_not_owned',
        'dot may decide only for runs dot started.'
      )
    }
    return { validation, runId }
  }

  return {
    listPending({ limit, origin }) {
      const scanned = port.listPendingDecisions(
        origin ? ORIGIN_SCAN_LIMIT : Math.min(limit + 1, ORIGIN_SCAN_LIMIT)
      )
      const kept = origin ? scanned.filter((entry) => originOf(entry.runId) === origin) : scanned
      const decisions = kept.slice(0, limit).flatMap((entry) => views.view(entry) ?? [])
      return { decisions, hasMore: kept.length > limit }
    },

    async decide({ validationId, decision, by }) {
      const { validation, runId } = decidable(validationId, by)
      const placement = views.placementOf(validation.dispatchId)
      // Why: a process that may still write must end before a merge; the waive still records.
      const processMayRun = decision === 'waive' && views.processMayRunOf(validation.dispatchId)
      const changes =
        decision === 'waive' && !processMayRun && placement?.mode === 'own_worktree'
          ? await readChanges(placement.worktree)
          : undefined
      const input = {
        validationId,
        by,
        resultSummary: decisionResultSummary(decision, by),
        notice: buildDecisionNotice({
          taskId: validation.taskId,
          dispatchId: validation.dispatchId,
          decision,
          by,
          placement,
          changes,
          processMayRun
        }),
        timestamp: now().toISOString()
      }
      const outcome = decision === 'waive' ? port.waive(input) : port.reject(input)
      const filed = outcome.attempt.notice
      if (filed) {
        deps.announce?.(filed)
      }
      return {
        validationId,
        taskId: validation.taskId,
        runId,
        decision: decision === 'waive' ? 'waived' : 'rejected',
        taskStatus: outcome.attempt.taskStatus,
        noticeFiled: filed !== null
      }
    }
  }
}

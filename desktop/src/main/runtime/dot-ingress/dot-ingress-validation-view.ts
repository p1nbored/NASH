import {
  DOT_VALIDATION_SUMMARY_MAX_CHARS,
  DotValidationViewSchema,
  type DotValidationReason,
  type DotValidationView
} from '../../../shared/dot-ingress/dot-ingress-validation'
import type { WorkbenchValidationDecisionView } from '../../../shared/rpc-contract/workbench-validation-decision-params'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import type {
  EvidenceRef,
  TaskValidationRecord,
  ValidationCheck
} from '../orchestration/db/task-validation-record'
import { getTaskValidationStore } from '../orchestration/db/task-validation-store'
import { readSessionReport } from '../task-validation/session-report'
import { dotSafeLine, dotValidationTitle } from './dot-ingress-validation-text'

// The dot view of one inconclusive result, built from the desktop entry's ids only: the desktop view's
// worktree, branch, path, base commit and model are never read into it (U32 exception, G7).

/** The ids of a desktop decision entry; nothing else of that view is used here. */
export type DotValidationEntry = Pick<
  WorkbenchValidationDecisionView,
  'validationId' | 'runId' | 'taskId' | 'dispatchId' | 'executorKind'
>

const MACHINE_CHECK_KINDS: ReadonlySet<string> = new Set([
  'executor_completed',
  'artifact_exists',
  'output_schema',
  'no_workspace_writes',
  'secret_scan_clean'
])
/** Evidence a review leaves only when the reviewer actually ran (model-review.ts). */
const REVIEWER_RAN = 'reviewer_run'

function firstUndecided(checks: readonly ValidationCheck[]): ValidationCheck | null {
  return checks.find((check) => check.status === 'inconclusive') ?? null
}

function isInSession(executorKind: string): boolean {
  return executorKind.startsWith('claude_')
}

/** The fixed code for the first check that could not decide; an unmapped one is `other`. */
export function dotValidationReason(
  validation: {
    readonly checks: readonly ValidationCheck[]
    readonly evidenceRefs: readonly EvidenceRef[]
  },
  executorKind: string
): DotValidationReason {
  const undecided = firstUndecided(validation.checks)
  if (!undecided) {
    return 'other'
  }
  if (undecided.kind === 'work_evidence') {
    return 'claim_only'
  }
  if (undecided.kind === 'session_report') {
    return executorKind === 'claude_primary' ? 'primary_did_task' : 'report_missing'
  }
  if (undecided.kind === 'model_review') {
    const ran = validation.evidenceRefs.some((evidence) => evidence.kind === REVIEWER_RAN)
    return ran ? 'review_inconclusive' : 'review_unavailable'
  }
  return MACHINE_CHECK_KINDS.has(undecided.kind) ? 'checks_inconclusive' : 'other'
}

/**
 * The text the summary is made from: the reviewer's line for a model review, the primary's task
 * report for an in-session task, else the undecided check's reason line. Still raw here.
 */
export function dotSummarySource(
  validation: Pick<TaskValidationRecord, 'policy' | 'checks'>,
  executorKind: string,
  report: string | null
): string | null {
  const undecided = firstUndecided(validation.checks)
  if (validation.policy === 'model_review') {
    const review = validation.checks.find(
      (check) => check.kind === 'model_review' && check.status === 'inconclusive'
    )
    return review?.note ?? undecided?.note ?? null
  }
  if (isInSession(executorKind) && report !== null) {
    return report
  }
  return undecided?.note ?? null
}

function firstLine(text: string): string {
  return text.split(/\r\n|[\n\r\u2028\u2029]/).find((line) => line.trim() !== '') ?? ''
}

function titleSource(owner: OrchestrationDb, taskId: string): string | null {
  const task = owner.getTask(taskId)
  if (!task) {
    return null
  }
  return task.task_title?.trim() ? task.task_title : firstLine(task.spec)
}

function reportOf(owner: OrchestrationDb, entry: DotValidationEntry): string | null {
  if (!isInSession(entry.executorKind)) {
    return null
  }
  const report = readSessionReport(owner, entry)
  return report.status === 'ok' ? report.text : null
}

/** Null when the validation row is gone; the view is parsed against the contract before it leaves. */
export function buildDotValidationView(
  owner: OrchestrationDb,
  entry: DotValidationEntry,
  dotRequestId: string
): DotValidationView | null {
  const validation = getTaskValidationStore(owner).get(entry.validationId)
  if (!validation) {
    return null
  }
  const summary = dotSafeLine(
    dotSummarySource(validation, entry.executorKind, reportOf(owner, entry)),
    DOT_VALIDATION_SUMMARY_MAX_CHARS
  )
  return DotValidationViewSchema.parse({
    validationId: validation.validationId,
    dotRequestId,
    title: dotValidationTitle(titleSource(owner, entry.taskId)),
    reason: dotValidationReason(validation, entry.executorKind),
    summary: summary.line,
    summaryWithheld: summary.withheld,
    createdAt: validation.updatedAt
  })
}

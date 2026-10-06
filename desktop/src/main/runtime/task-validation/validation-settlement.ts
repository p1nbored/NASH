import { ATTEMPT_RESULT_MAX_CHARS } from '../orchestration/db/app-attempt-input'
import type { RecordVerdictInput } from '../orchestration/db/app-attempt-validation-outcome'
import {
  VALIDATION_CHECKS_MAX_CHARS,
  VALIDATION_CHECKS_MAX_ITEMS,
  VALIDATION_EVIDENCE_MAX_ITEMS,
  type EvidenceRef
} from '../orchestration/db/task-validation-record'
import type { AttemptPlacement } from '../task-execution/attempt-workspace'
import {
  attemptWorkspaceNotice,
  type WorktreeChangeFacts
} from '../task-execution/task-result-notice'
import type { CheckStatus } from './validation-context'
import { recordLine } from './validation-record-text'

export type DecidedCheck = {
  readonly kind: string
  readonly status: CheckStatus
  readonly note: string
}
export type Verdict = CheckStatus

const NOTE_OVERHEAD_CHARS = 110
/** Wide enough for the shortened-note fallback, which recordLine checks against the same bound. */
const MIN_NOTE_CHARS = 60
const SHORTENED_NOTE = 'The check note was cut to fit the record.'
const FIT_ROUNDS = 3
const SUBJECT_MAX_CHARS = 200

/** Any failed check fails the attempt; otherwise any undecided one leaves it to the user or dot. */
export function decideVerdict(checks: readonly { status: CheckStatus }[]): Verdict {
  if (checks.length === 0) {
    return 'inconclusive'
  }
  if (checks.some((check) => check.status === 'fail')) {
    return 'fail'
  }
  return checks.some((check) => check.status === 'inconclusive') ? 'inconclusive' : 'pass'
}

/** Shortens the notes until the checks fit the store's column. */
function fitChecks(checks: readonly DecidedCheck[]): DecidedCheck[] {
  let fitted = checks.slice(0, VALIDATION_CHECKS_MAX_ITEMS)
  for (
    let round = 0;
    round < FIT_ROUNDS && JSON.stringify(fitted).length > VALIDATION_CHECKS_MAX_CHARS;
    round += 1
  ) {
    const perNote = Math.max(
      MIN_NOTE_CHARS,
      Math.floor(
        (VALIDATION_CHECKS_MAX_CHARS / (round + 1) - fitted.length * NOTE_OVERHEAD_CHARS) /
          fitted.length
      )
    )
    fitted = fitted.map((check) => ({
      ...check,
      note: recordLine(check.note, {
        fallback: SHORTENED_NOTE,
        maxChars: perNote
      })
    }))
  }
  return fitted
}

function uniqueEvidence(evidence: readonly EvidenceRef[]): EvidenceRef[] {
  const key = (ref: EvidenceRef): string => `${ref.kind}\u0000${ref.ref}`
  return evidence
    .filter((ref, index) => evidence.findIndex((other) => key(other) === key(ref)) === index)
    .slice(0, VALIDATION_EVIDENCE_MAX_ITEMS)
}

function summaryOf(verdict: Verdict, checks: readonly DecidedCheck[]): string {
  const deciding = checks.find((check) => check.status === verdict)?.note ?? ''
  const text =
    verdict === 'pass'
      ? `Validation passed: all ${checks.length} checks passed.`
      : verdict === 'fail'
        ? `Validation failed: ${deciding}`
        : `Validation is inconclusive and waits for a decision by the user or dot: ${deciding}`
  return recordLine(text, {
    fallback: `Validation ended: ${verdict}.`,
    maxChars: ATTEMPT_RESULT_MAX_CHARS
  })
}

function countsOf(checks: readonly DecidedCheck[]): string {
  const count = (status: CheckStatus): number =>
    checks.filter((check) => check.status === status).length
  return `${checks.length} checks: ${count('pass')} passed, ${count('fail')} failed, ${count('inconclusive')} undecided.`
}

/** The fixed counts line, then the D-025 merge rule for a task that wrote in its own place. */
function noticeBody(
  checks: readonly DecidedCheck[],
  verdict: Verdict,
  attempt: VerdictAttempt | undefined
): string {
  const fixed = `${countsOf(checks)} Read the validation record for the reasons.`
  const workspace = attempt ? attemptWorkspaceNotice({ ...attempt, verdict }) : null
  return workspace === null ? fixed : `${fixed} ${workspace}`
}

/** The attempt a verdict settles, for the notice; `placement` comes from its launch evidence. */
export type VerdictAttempt = {
  readonly dispatchId: string
  readonly placement: AttemptPlacement | null
  /** What git showed in its own worktree, read only for a pass; absent, no git fact is stated. */
  readonly changes?: WorktreeChangeFacts
}

/** The verdict a record of these checks gets: a pass with no evidence is left undecided. */
export function settledVerdict(
  checks: readonly { status: CheckStatus }[],
  evidence: readonly EvidenceRef[]
): Verdict {
  const decided = decideVerdict(checks)
  return decided === 'pass' && evidence.length === 0 ? 'inconclusive' : decided
}

/** The one verdict record for a validation, with an English summary and a mailbox notice for the primary. */
export function buildVerdictInput(input: {
  readonly validationId: string
  readonly taskId: string
  readonly checks: readonly DecidedCheck[]
  readonly evidence: readonly EvidenceRef[]
  readonly attempt?: VerdictAttempt
  readonly timestamp: string
}): RecordVerdictInput {
  const evidenceRefs = uniqueEvidence(input.evidence)
  // Why: a pass must point at evidence, so a pass with none is left to the user or dot.
  const unsupported = decideVerdict(input.checks) === 'pass' && evidenceRefs.length === 0
  const checks = fitChecks(
    unsupported
      ? [
          ...input.checks,
          {
            kind: 'evidence',
            status: 'inconclusive',
            note: 'No evidence was recorded to support a pass.'
          }
        ]
      : input.checks
  )
  const verdict = settledVerdict(input.checks, evidenceRefs)
  const resultSummary = summaryOf(verdict, checks)
  return {
    validationId: input.validationId,
    verdict,
    checks: checks.map((check) => ({ kind: check.kind, status: check.status, note: check.note })),
    evidenceRefs,
    resultSummary,
    notice: {
      subject: recordLine(
        `Validation ${verdict === 'fail' ? 'failed' : verdict === 'pass' ? 'passed' : 'inconclusive'} for task ${input.taskId}`,
        {
          fallback: 'Validation result',
          maxChars: SUBJECT_MAX_CHARS
        }
      ),
      // Why: fixed templates, so no worker or reviewer text reaches the primary's mailbox.
      body: noticeBody(checks, verdict, input.attempt)
    },
    timestamp: input.timestamp
  }
}

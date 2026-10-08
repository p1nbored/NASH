import type { AttemptFacts } from './attempt-evidence'
import type { ValidationStrategy } from './validation-strategies'

// A TaskSpec without machine checks or an explicit review request gets no second-model review.

export const SESSION_REPORT_VALIDATOR_ID = 'session_report'
const SESSION_REPORT = 'session_report'
/** The only targets whose attempts pass on the primary's report; restriction 27 stays for the rest. */
const REPORT_PASSES_TARGETS: ReadonlySet<string> = new Set(['claude_subagent', 'claude_workflow'])

const NOTES = {
  claim:
    "The primary session reported this subagent or workflow attempt as succeeded. That report is the session's own claim, accepted as the completion check for these tasks (D-027); the work itself was not checked.",
  missing: 'The primary session filed no report for this attempt in the run mailbox.',
  mismatched: 'The report in the run mailbox does not match the current attempt.',
  primarySelf:
    'The primary session did this task itself, so its own report is not enough (D-027 keeps this rule for such tasks). Waive or reject the result, or propose the task again with a machine check or review "model".'
} as const

function undecided(note: string) {
  return { checks: [{ kind: SESSION_REPORT, status: 'inconclusive', note }], evidence: [] } as const
}

/** A subagent or workflow attempt passes on the primary's succeeded report, kept as a claim on record. */
function sessionReportStrategy(facts: AttemptFacts): ValidationStrategy {
  return {
    open: {
      policy: 'machine_checks',
      validatorId: SESSION_REPORT_VALIDATOR_ID,
      workerModel: null,
      reviewerModel: null
    },
    decide: async () => {
      if (!facts.routeTarget || !REPORT_PASSES_TARGETS.has(facts.routeTarget)) {
        return undecided(NOTES.primarySelf)
      }
      const report = facts.sessionReport
      if (!report || report.status !== 'ok') {
        return undecided(report?.status === 'mismatched' ? NOTES.mismatched : NOTES.missing)
      }
      return {
        checks: [{ kind: SESSION_REPORT, status: 'pass', note: NOTES.claim }],
        evidence: [{ kind: 'session_report_claim', ref: report.messageId }]
      }
    }
  }
}

/** In-session attempts use the primary's recorded report. */
export function defaultStrategy(facts: AttemptFacts): ValidationStrategy {
  return sessionReportStrategy(facts)
}

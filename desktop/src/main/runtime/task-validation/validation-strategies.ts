import type {
  TaskValidationOpenInput,
  TaskValidationRecord,
  EvidenceRef
} from '../orchestration/db/task-validation-store'
import type { AttemptFacts } from './attempt-evidence'
import { runMachineChecks, type MachineCheckDeps } from './deterministic-validators'
import {
  runModelReview,
  selectReviewer,
  type ModelReviewDeps,
  type ReviewerSelection
} from './model-review'
import { buildReviewPrompt } from './model-review-prompt'
import type { TaskValidationPort } from './task-validation-port'
import type { PlannedCheck } from './validation-policy'
import { errorNameOf } from './validation-context'
import type { DecidedCheck } from './validation-settlement'

/** Recorded as the reviewer of a review that never got one, so the decision still names its reviewer. */
export const REVIEWER_UNASSIGNED = 'unassigned'
export const MACHINE_VALIDATOR_ID = 'machine_checks'
const REVIEW_VALIDATOR_ID = 'model_review'
/** Checks that show the work happened; the others only show that nothing went wrong. */
const POSITIVE_CHECK_KINDS: ReadonlySet<string> = new Set(['artifact_exists'])
const NO_WORK_EVIDENCE = {
  kind: 'work_evidence',
  status: 'inconclusive',
  note: 'The TaskSpec lists no check that shows the work was done, such as artifact_exists.'
} as const

export type Decided = {
  readonly checks: readonly DecidedCheck[]
  readonly evidence: readonly EvidenceRef[]
}

/** How one attempt is validated: what the validation row names, and how its checks are decided. */
export type ValidationStrategy = {
  readonly open: Pick<
    TaskValidationOpenInput,
    'policy' | 'validatorId' | 'workerModel' | 'reviewerModel'
  >
  readonly decide: (validation: TaskValidationRecord) => Promise<Decided>
}

export type StrategyDeps = {
  readonly port: TaskValidationPort
  readonly machine: Omit<MachineCheckDeps, 'recorder' | 'signal'>
  readonly review: ModelReviewDeps
}

async function decideMachineChecks(
  checks: readonly PlannedCheck[],
  facts: AttemptFacts,
  deps: StrategyDeps,
  signal?: AbortSignal
): Promise<Decided> {
  const outcomes = await runMachineChecks(checks, facts.evidence, {
    ...deps.machine,
    recorder: deps.port,
    signal
  })
  return { checks: outcomes, evidence: outcomes.flatMap((outcome) => outcome.evidence) }
}

export function machineStrategy(
  checks: readonly PlannedCheck[],
  facts: AttemptFacts,
  deps: StrategyDeps,
  signal?: AbortSignal,
  validatorId: string = MACHINE_VALIDATOR_ID
): ValidationStrategy {
  return {
    open: { policy: 'machine_checks', validatorId, workerModel: null, reviewerModel: null },
    decide: async () => {
      const decided = await decideMachineChecks(checks, facts, deps, signal)
      // Why: checks that only show nothing went wrong cannot show the work was done.
      const showsWork = checks.some((check) => POSITIVE_CHECK_KINDS.has(check.kind))
      return showsWork ? decided : { ...decided, checks: [...decided.checks, NO_WORK_EVIDENCE] }
    }
  }
}

/** A validator that threw cannot decide; the error's name is kept, never its message. */
export function validatorFailure(error: unknown): Decided {
  return {
    checks: [
      {
        kind: 'validator_error',
        status: 'inconclusive',
        note: `The validator stopped on an internal error (${errorNameOf(error)}).`
      }
    ],
    evidence: []
  }
}

/** A review found pending when nobody is running it was cut off; it is not run, and billed, again. */
export function interruptedReview(): Decided {
  return {
    checks: [
      {
        kind: 'model_review',
        status: 'inconclusive',
        note: 'The review was interrupted before it settled and is not run again automatically.'
      }
    ],
    evidence: []
  }
}

const SESSION_REPORT_UNUSABLE = {
  missing:
    'The in-session worker filed no report in the run mailbox, so there is nothing to review.',
  mismatched:
    'The report in the run mailbox does not match the current attempt, so it is not reviewed.'
} as const

function unreviewable(note: string): Decided {
  return { checks: [{ kind: 'model_review', status: 'inconclusive', note }], evidence: [] }
}

function reviewRunIdOf(validationId: string): string {
  return `review-${validationId.replace(/^validation_/, '').replace(/[^A-Za-z0-9_-]/g, '-')}`.slice(
    0,
    64
  )
}

async function reviewAttempt(
  selection: Extract<ReviewerSelection, { ok: true }>,
  facts: AttemptFacts,
  deps: StrategyDeps,
  run: { readonly runId: string; readonly signal?: AbortSignal }
): Promise<Decided> {
  const { evidence, spec, sessionReport } = facts
  // Why: a missing or foreign report leaves nothing of this attempt to judge, so no review is billed.
  if (sessionReport.status !== 'ok') {
    return unreviewable(SESSION_REPORT_UNUSABLE[sessionReport.status])
  }
  const canReadWorkspace = evidence.workspace !== null
  const result = { kind: 'session_report', text: sessionReport.text } as const
  const prompt = buildReviewPrompt({
    objective: facts.objective,
    expectedOutputs: spec.expectedOutputs,
    acceptanceCriteria: spec.acceptanceCriteria,
    constraints: spec.constraints,
    artifacts: deps.port.listArtifacts(evidence.dispatchId),
    result,
    canReadWorkspace
  })
  const reviewed = await runModelReview(
    selection,
    {
      prompt,
      criteriaCount: spec.acceptanceCriteria.length,
      workModel: facts.workModel,
      workspacePath: evidence.workspace?.path ?? null,
      ...(evidence.workspace ? { workspaceKind: evidence.workspace.kind } : {}),
      runId: run.runId,
      signal: run.signal
    },
    deps.review
  )
  return {
    ...reviewed,
    evidence: [...reviewed.evidence, { kind: 'session_report', ref: sessionReport.messageId }]
  }
}

/** D-027: the TaskSpec's machine checks run before a requested review; a failing one bills no review. */
function afterMachineChecks(
  checks: readonly PlannedCheck[],
  facts: AttemptFacts,
  deps: StrategyDeps,
  signal: AbortSignal | undefined,
  review: () => Promise<Decided>
): Promise<Decided> {
  if (checks.length === 0) {
    return review()
  }
  return decideMachineChecks(checks, facts, deps, signal).then(async (machine) => {
    if (machine.checks.some((check) => check.status === 'fail')) {
      return machine
    }
    const reviewed = await review()
    return {
      checks: [...machine.checks, ...reviewed.checks],
      evidence: [...machine.evidence, ...reviewed.evidence]
    }
  })
}

export async function reviewStrategy(
  facts: AttemptFacts,
  deps: StrategyDeps,
  signal?: AbortSignal,
  checks: readonly PlannedCheck[] = []
): Promise<ValidationStrategy> {
  const selection = await selectReviewer(
    { workModel: facts.workModel, workspaceId: facts.workspaceId, signal },
    deps.review.resolver
  )
  const open = {
    policy: 'model_review',
    validatorId: REVIEW_VALIDATOR_ID,
    workerModel: facts.workModel,
    reviewerModel: selection.ok
      ? selection.reviewer.model
      : (selection.reviewerModel ?? REVIEWER_UNASSIGNED)
  } as const
  if (!selection.ok) {
    const unavailable = [
      { kind: 'model_review', status: 'inconclusive', note: selection.note }
    ] as const
    return {
      open,
      decide: async () =>
        afterMachineChecks(checks, facts, deps, signal, async () => ({
          checks: unavailable,
          evidence: []
        }))
    }
  }
  return {
    open,
    decide: async (validation) =>
      afterMachineChecks(checks, facts, deps, signal, () =>
        reviewAttempt(selection, facts, deps, {
          runId: reviewRunIdOf(validation.validationId),
          signal
        })
      )
  }
}

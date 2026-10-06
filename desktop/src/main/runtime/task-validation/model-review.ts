import type { ValidationReviewerTarget } from '../../../shared/routing-table/routing-table-taxonomy'
import {
  isDispatchable,
  type RouteSubject
} from '../../routing-table/availability/route-availability-types'
import type { RouteResolver } from '../../routing-table/route-resolver'
import type { EvidenceRef } from '../orchestration/db/task-validation-record'
import { isSameModel, normalizeModelId } from './model-id-normalization'
import {
  REVIEW_OUTPUT_SCHEMA,
  parseReviewOutput,
  reviewChecks,
  type ReviewCheck
} from './model-review-verdict'
import type { ReviewerRequest, ReviewerRunner, ReviewerRunOutcome } from './reviewer-runner'
import { recordLine } from './validation-record-text'

export type ReviewerResolverPort = Pick<RouteResolver, 'resolveValidationReviewer' | 'latch'>

export type SelectedReviewer = {
  readonly target: ValidationReviewerTarget
  readonly model: string
  readonly effort: string | null
  readonly subject: RouteSubject
}

export type ReviewerSelection =
  | { readonly ok: true; readonly reviewer: SelectedReviewer }
  | {
      readonly ok: false
      /** The reviewer the table named but could not dispatch; null when there was none to name. */
      readonly reviewerModel: string | null
      readonly reason: string
      readonly note: string
    }

export type ModelReviewDeps = {
  readonly resolver: ReviewerResolverPort
  readonly runners: Readonly<Record<ValidationReviewerTarget, ReviewerRunner>>
}

export type ModelReviewResult = {
  readonly checks: readonly ReviewCheck[]
  readonly evidence: readonly EvidenceRef[]
}

function noReviewer(
  reason: string,
  note: string,
  reviewerModel: string | null = null
): ReviewerSelection {
  return { ok: false, reviewerModel, reason, note }
}

/** D-020: the table's first independent reviewer; if it cannot run, the result is inconclusive. */
export async function selectReviewer(
  input: {
    readonly workModel: string | null
    readonly workspaceId: string
    readonly signal?: AbortSignal
  },
  resolver: Pick<ReviewerResolverPort, 'resolveValidationReviewer'>
): Promise<ReviewerSelection> {
  const workModel = normalizeModelId(input.workModel)
  if (workModel === null) {
    return noReviewer(
      'work_model_unknown',
      'The model that did the work is not known, so no independent reviewer can be chosen.'
    )
  }
  const resolution = await resolver.resolveValidationReviewer({
    workModel,
    workspace: { workspaceId: input.workspaceId },
    signal: input.signal
  })
  if (!resolution.ok) {
    return noReviewer(
      resolution.reason,
      `No independent reviewer is available (${resolution.reason}).`
    )
  }
  const { reviewer, availability } = resolution
  if (isSameModel(reviewer.model, workModel) !== false) {
    return noReviewer(
      'reviewer_not_independent',
      'The first reviewer in the table is the work model under another name.'
    )
  }
  if (!isDispatchable(availability)) {
    const reason =
      availability.status === 'unavailable' ? 'reviewer_unavailable' : 'reviewer_unverified'
    const note = `The reviewer is ${availability.status} (${availability.reasons.join(', ')}), and no other reviewer is tried.`
    return noReviewer(reason, note, reviewer.model)
  }
  return {
    ok: true,
    reviewer: {
      target: reviewer.target,
      model: availability.cli.model,
      effort: availability.cli.effort,
      subject: availability.subject
    }
  }
}

function undecided(note: string, evidence: readonly EvidenceRef[] = []): ModelReviewResult {
  return {
    checks: [
      {
        kind: 'model_review',
        status: 'inconclusive',
        note: recordLine(note, { fallback: 'The review could not decide.' })
      }
    ],
    evidence
  }
}

/** Every model the CLI reports must be shown different; the Claude CLI must report one, as it can fall back. */
function independenceProblem(
  reportedModels: readonly string[],
  input: { readonly workModel: string | null; readonly target: ValidationReviewerTarget }
): string | null {
  if (input.target === 'claude_headless' && reportedModels.length === 0) {
    return 'The reviewing CLI did not report which model served the review.'
  }
  return reportedModels.some((model) => isSameModel(model, input.workModel) !== false)
    ? 'The reviewing CLI reported a model not shown to differ from the work model.'
    : null
}

function settle(
  outcome: ReviewerRunOutcome,
  input: {
    readonly criteriaCount: number
    readonly workModel: string | null
    readonly runId: string
    readonly target: ValidationReviewerTarget
  }
): ModelReviewResult {
  if (outcome.status === 'blocked') {
    return undecided(`The reviewer was blocked (${outcome.reason}).`)
  }
  if (outcome.status !== 'completed') {
    return undecided(`The review run did not complete (${outcome.reason}).`)
  }
  const evidence = [
    { kind: 'review_output', ref: outcome.outputSha256 },
    { kind: 'reviewer_run', ref: input.runId }
  ]
  const independence = independenceProblem(outcome.reportedModels, input)
  if (independence !== null) {
    return undecided(independence, evidence)
  }
  const parsed = parseReviewOutput(outcome.text, input.criteriaCount)
  if (!parsed.ok) {
    return undecided(`The review was not usable: ${parsed.problem}`, evidence)
  }
  return { checks: reviewChecks(parsed.review), evidence }
}

/** Runs the selected reviewer once; its reply decides only in the one accepted shape. */
export async function runModelReview(
  selection: Extract<ReviewerSelection, { ok: true }>,
  input: {
    readonly prompt: string
    readonly criteriaCount: number
    readonly workModel: string | null
    readonly workspacePath: string | null
    readonly workspaceKind?: ReviewerRequest['workspaceKind']
    readonly runId: string
    readonly signal?: AbortSignal
  },
  deps: ModelReviewDeps
): Promise<ModelReviewResult> {
  const { reviewer } = selection
  const outcome = await deps.runners[reviewer.target]({
    prompt: input.prompt,
    model: reviewer.model,
    effort: reviewer.effort,
    workspacePath: input.workspacePath,
    ...(input.workspaceKind === undefined ? {} : { workspaceKind: input.workspaceKind }),
    runId: input.runId,
    outputSchema: REVIEW_OUTPUT_SCHEMA,
    signal: input.signal
  })
  if (outcome.status === 'blocked') {
    deps.resolver.latch(reviewer.subject, outcome.reason)
  }
  return settle(outcome, { ...input, target: reviewer.target })
}

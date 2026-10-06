import type { AwaitingValidationEntry } from '../orchestration/db/app-attempt-queries'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { WorktreeChangeFacts } from '../task-execution/task-result-notice'
import type { AttemptFacts } from './attempt-evidence'
import type { AttemptWorktreeChangesReader } from './attempt-worktree-changes'
import type { ModelReviewDeps } from './model-review'
import type { TaskValidationPort } from './task-validation-port'
import { defaultStrategy } from './validation-default-strategy'
import { planValidation } from './validation-policy'
import { buildVerdictInput, settledVerdict, type Verdict } from './validation-settlement'
import {
  interruptedReview,
  machineStrategy,
  reviewStrategy,
  validatorFailure,
  type Decided,
  type StrategyDeps,
  type ValidationStrategy
} from './validation-strategies'
import type { WorkspaceGitPort } from './workspace-write-check'

const DEFAULT_BATCH = 20
/** The store's largest page: undecided attempts are picked from it, so waiting decisions cannot starve them. */
const AWAITING_SCAN_LIMIT = 1000

export type ValidationRunnerDeps = {
  readonly port: TaskValidationPort
  readonly reader: { read(entry: AwaitingValidationEntry): Promise<AttemptFacts | null> }
  readonly git: WorkspaceGitPort
  /** Git facts of a passed attempt's own worktree for its merge notice; absent, none are stated. */
  readonly readWorktreeChanges?: AttemptWorktreeChangesReader
  readonly review: ModelReviewDeps
  readonly now: () => Date
}

export type ValidationRunReport =
  | {
      readonly dispatchId: string
      readonly outcome: 'settled'
      readonly verdict: Verdict
      readonly validationId: string
    }
  | { readonly dispatchId: string; readonly outcome: 'skipped'; readonly reason: string }

/** Validators determine completion (D-016); this surface has no way to waive or reject a result. */
export type ValidationRunner = {
  validatePending(options?: {
    readonly limit?: number
    readonly signal?: AbortSignal
  }): Promise<ValidationRunReport[]>
  /** The attempt is re-read from the store by its Dispatch id, never taken from a caller's snapshot. */
  validateAttempt(dispatchId: string, signal?: AbortSignal): Promise<ValidationRunReport>
}

const skipped = (dispatchId: string, reason: string): ValidationRunReport => ({
  dispatchId,
  outcome: 'skipped',
  reason
})

type Decision =
  | { readonly kind: 'decided'; readonly validationId: string; readonly decided: Decided }
  | { readonly kind: 'skip'; readonly reason: string }

async function strategyFor(
  facts: AttemptFacts,
  deps: ValidationRunnerDeps,
  signal?: AbortSignal
): Promise<ValidationStrategy> {
  const strategyDeps: StrategyDeps = {
    port: deps.port,
    machine: { git: deps.git, now: deps.now },
    review: deps.review
  }
  const plan = planValidation(facts.spec)
  switch (plan.policy) {
    case 'machine_checks':
      return machineStrategy(plan.checks, facts, strategyDeps, signal)
    case 'model_review':
      return reviewStrategy(facts, strategyDeps, signal, plan.checks)
    case 'default':
      return defaultStrategy(facts, strategyDeps, signal)
  }
}

async function decideSafely(
  strategy: ValidationStrategy,
  record: Parameters<ValidationStrategy['decide']>[0]
): Promise<Decided> {
  try {
    return await strategy.decide(record)
  } catch (error) {
    // Why: a crashed check or reviewer must settle as undecided, not leave the attempt pending.
    return validatorFailure(error)
  }
}

/** Opens the validation (or resumes an interrupted review) and decides it, unless it was settled meanwhile. */
async function openAndDecide(
  entry: AwaitingValidationEntry,
  facts: AttemptFacts,
  deps: ValidationRunnerDeps,
  signal?: AbortSignal
): Promise<Decision> {
  const resumed = entry.validationId ? deps.port.getValidation(entry.validationId) : null
  if (resumed?.policy === 'model_review') {
    return { kind: 'decided', validationId: resumed.validationId, decided: interruptedReview() }
  }
  const strategy = await strategyFor(facts, deps, signal)
  if (signal?.aborted) {
    return { kind: 'skip', reason: 'cancelled' }
  }
  const { duplicate, record } = deps.port.open({
    taskId: entry.taskId,
    dispatchId: entry.dispatchId,
    ...strategy.open,
    timestamp: deps.now().toISOString()
  })
  if (record.verdict !== 'pending') {
    return { kind: 'skip', reason: 'already_decided' }
  }
  if (duplicate && record.policy === 'model_review') {
    return { kind: 'decided', validationId: record.validationId, decided: interruptedReview() }
  }
  return {
    kind: 'decided',
    validationId: record.validationId,
    decided: await decideSafely(strategy, record)
  }
}

/** D-025: before a pass tells the primary to merge, git is read in the attempt's own worktree. */
async function passedWorktreeChanges(
  facts: AttemptFacts,
  decided: Decided,
  deps: ValidationRunnerDeps,
  signal?: AbortSignal
): Promise<WorktreeChangeFacts | undefined> {
  const { placement } = facts.evidence
  if (
    placement?.mode !== 'own_worktree' ||
    settledVerdict(decided.checks, decided.evidence) !== 'pass'
  ) {
    return undefined
  }
  try {
    return await deps.readWorktreeChanges?.(placement.worktree, signal)
  } catch {
    // Why: a failed read must not hold the verdict back; the notice then asks for a check instead.
    return { readable: false }
  }
}

async function decideAndRecord(
  entry: AwaitingValidationEntry,
  deps: ValidationRunnerDeps,
  signal?: AbortSignal
): Promise<ValidationRunReport> {
  const facts = await deps.reader.read(entry)
  if (!facts) {
    return skipped(entry.dispatchId, 'attempt_unreadable')
  }
  const decision = await openAndDecide(entry, facts, deps, signal)
  if (decision.kind === 'skip' || signal?.aborted) {
    return skipped(entry.dispatchId, decision.kind === 'skip' ? decision.reason : 'cancelled')
  }
  const { validationId, decided } = decision
  const changes = await passedWorktreeChanges(facts, decided, deps, signal)
  const outcome = deps.port.recordVerdict(
    buildVerdictInput({
      validationId,
      taskId: entry.taskId,
      ...decided,
      attempt: { dispatchId: entry.dispatchId, placement: facts.evidence.placement, changes },
      timestamp: deps.now().toISOString()
    })
  )
  const { verdict } = outcome.validation
  if (verdict === 'pending') {
    throw new Error('The store left a recorded validation pending.')
  }
  return { dispatchId: entry.dispatchId, outcome: 'settled', verdict, validationId }
}

async function validateOne(
  dispatchId: string,
  deps: ValidationRunnerDeps,
  inFlight: Set<string>,
  signal?: AbortSignal
): Promise<ValidationRunReport> {
  if (inFlight.has(dispatchId)) {
    return skipped(dispatchId, 'in_flight')
  }
  if (signal?.aborted) {
    return skipped(dispatchId, 'cancelled')
  }
  const entry = deps.port.getAwaiting(dispatchId)
  if (!entry) {
    return skipped(dispatchId, 'not_awaiting')
  }
  if (entry.verdict === 'inconclusive') {
    return skipped(dispatchId, 'awaiting_decision')
  }
  inFlight.add(dispatchId)
  try {
    return await decideAndRecord(entry, deps, signal)
  } catch (error) {
    // Why: the attempt moved on (stopped, canceled, reset) or the store refused; nothing is forced.
    return skipped(dispatchId, error instanceof OrchestrationError ? error.code : 'internal_error')
  } finally {
    inFlight.delete(dispatchId)
  }
}

export function createValidationRunner(deps: ValidationRunnerDeps): ValidationRunner {
  const inFlight = new Set<string>()
  return {
    validateAttempt: (dispatchId, signal) => validateOne(dispatchId, deps, inFlight, signal),
    async validatePending(options = {}) {
      const undecided = deps.port
        .listAwaiting(AWAITING_SCAN_LIMIT)
        .filter((entry) => entry.verdict !== 'inconclusive')
        .slice(0, options.limit ?? DEFAULT_BATCH)
      const reports: ValidationRunReport[] = []
      // Why one at a time: each review is a billed CLI run, so they are never fanned out.
      for (const entry of undecided) {
        reports.push(await validateOne(entry.dispatchId, deps, inFlight, options.signal))
      }
      return reports
    }
  }
}

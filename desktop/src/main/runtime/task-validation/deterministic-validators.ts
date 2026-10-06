import { checkArtifactExists, checkSecretScanClean, type ArtifactRecorder } from './artifact-checks'
import { checkExecutorCompleted, checkOutputSchema } from './executor-checks'
import {
  errorNameOf,
  quoted,
  undecided,
  type AttemptEvidence,
  type CheckOutcome
} from './validation-context'
import type { PlannedCheck } from './validation-policy'
import { checkNoWorkspaceWrites, type WorkspaceGitPort } from './workspace-write-check'

export type MachineCheckDeps = {
  readonly recorder: ArtifactRecorder
  readonly git: WorkspaceGitPort
  readonly now: () => Date
  readonly signal?: AbortSignal
}

function kindOf(check: PlannedCheck): string {
  return check.kind === 'invalid' ? check.specKind : check.kind
}

function unusable(check: Extract<PlannedCheck, { kind: 'invalid' }>): CheckOutcome {
  return undecided(
    check.specKind,
    check.problem === 'unknown_kind'
      ? `The check kind ${quoted(check.specKind)} is not one the validators know.`
      : `The check ${quoted(check.specKind)} has parameters the validators cannot use.`
  )
}

async function runOne(
  check: PlannedCheck,
  evidence: AttemptEvidence,
  deps: MachineCheckDeps
): Promise<CheckOutcome> {
  switch (check.kind) {
    case 'executor_completed':
      return checkExecutorCompleted(evidence)
    case 'artifact_exists':
      return checkArtifactExists(evidence, check, deps.recorder, deps.now().toISOString())
    case 'output_schema':
      return checkOutputSchema(evidence, check.schema)
    case 'no_workspace_writes':
      return checkNoWorkspaceWrites(evidence, deps.git, deps.signal)
    case 'secret_scan_clean':
      return checkSecretScanClean(evidence, deps.recorder)
    case 'invalid':
      return unusable(check)
  }
}

async function guarded(
  check: PlannedCheck,
  evidence: AttemptEvidence,
  deps: MachineCheckDeps
): Promise<CheckOutcome> {
  try {
    return await runOne(check, evidence, deps)
  } catch (error) {
    // Why: one broken check must not leave the attempt unvalidated; only the error's name is kept.
    return undecided(
      kindOf(check),
      `The check stopped on an internal error (${errorNameOf(error)}).`
    )
  }
}

/** One outcome per check in TaskSpec order; the secret scan runs last to cover every recorded artifact. */
export async function runMachineChecks(
  checks: readonly PlannedCheck[],
  evidence: AttemptEvidence,
  deps: MachineCheckDeps
): Promise<CheckOutcome[]> {
  const outcomes = new Map<number, CheckOutcome>()
  const scanLast = (check: PlannedCheck): boolean => check.kind === 'secret_scan_clean'
  for (const phase of [false, true]) {
    for (const [index, check] of checks.entries()) {
      if (scanLast(check) === phase) {
        outcomes.set(index, await guarded(check, evidence, deps))
      }
    }
  }
  return checks.map(
    (check, index) => outcomes.get(index) ?? undecided(kindOf(check), 'The check did not run.')
  )
}

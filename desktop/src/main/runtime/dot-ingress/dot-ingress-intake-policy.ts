import type {
  DotRequestAccess,
  DotSubmissionFailure
} from '../../../shared/dot-ingress/dot-ingress-limits'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import type { DotIngressServiceDeps } from './dot-ingress-ports'
import {
  admitDotWorkspace,
  dotRefusal,
  orchestrationCodeOf,
  requireDotInterfaceOn,
  type AdmittedDotWorkspace
} from './dot-ingress-refusals'
import { analyzeDotRequirement } from './dot-ingress-requirement-analysis'

// The dot admission policy as it stands now, run right before every door submit (first submission,
// replay and recovery alike): the interface switch, the workspace the user enabled, its access
// maximum, the app's workspace catalog and the requirement rules. The submission caps are not
// re-run: they count the dot rows the store creates, and a recorded request was counted already.

export type DotIntakeTarget = {
  readonly workspaceRef: string
  readonly requestedAccess: DotRequestAccess
  /** The recorded workspace, or null for a request that is not recorded yet. */
  readonly recorded: { readonly workspaceId: string; readonly workspaceBinding: string } | null
}

/** Rail: the workspace's access maximum, set by the user when enabling it; never raised for dot. */
function requireAccessWithinMaximum(
  maxAccess: DotRequestAccess,
  requested: DotRequestAccess
): void {
  if (requested === 'workspace_write' && maxAccess !== 'workspace_write') {
    throw dotRefusal('dot_access_above_maximum', {
      reason: 'access_above_workspace_maximum',
      maxAccess
    })
  }
}

/** Throws the matching dot refusal while the policy refuses; returns the workspace for the door. */
export function admitDotIntake(
  deps: Pick<DotIngressServiceDeps, 'db' | 'requireWorkspace'>,
  target: DotIntakeTarget
): AdmittedDotWorkspace {
  requireDotInterfaceOn(deps.db)
  const settings = getDotIngressSettingsStore(deps.db)
  const entry = settings.getWorkspace(target.workspaceRef)
  if (!entry?.enabled) {
    throw dotRefusal('dot_workspace_unknown')
  }
  requireAccessWithinMaximum(
    settings.getWorkspaceMaxAccess(entry.workspaceRef),
    target.requestedAccess
  )
  const admitted = admitDotWorkspace(deps, entry.workspaceId)
  const { recorded } = target
  // Why: a request recorded for one workspace never goes to another one behind the same reference.
  if (
    recorded &&
    (recorded.workspaceId !== entry.workspaceId ||
      recorded.workspaceBinding !== entry.workspaceBinding ||
      recorded.workspaceBinding !== admitted.binding)
  ) {
    throw dotRefusal('dot_workspace_unavailable')
  }
  return admitted
}

/** The requirement rules again, for a recorded request; the stored text is checked as stored. */
export function requireRecordedRequirement(
  objective: string,
  deliverableLanguage: string | null
): void {
  analyzeDotRequirement({ objective, deliverableLanguage })
}

// A refusal of a recorded request as the coarse failure the store keeps (A6's three values).
const FAILURE_BY_REFUSAL: ReadonlyMap<string, DotSubmissionFailure> = new Map([
  ['dot_ingress_disabled', 'intake_refused'],
  ['dot_workspace_unknown', 'workspace_unavailable'],
  ['dot_workspace_unavailable', 'workspace_unavailable'],
  ['dot_access_above_maximum', 'intake_refused'],
  ['dot_requirement_not_english', 'intake_refused'],
  ['dot_requirement_unclear', 'intake_refused'],
  ['dot_requirement_too_long', 'intake_refused'],
  ['dot_requirement_rejected_content', 'intake_refused'],
  ['dot_deliverable_language_invalid', 'intake_refused']
])

/** The failure a policy refusal settles a recorded request with, or null for any other error. */
export function intakeFailureOfRefusal(error: unknown): DotSubmissionFailure | null {
  return FAILURE_BY_REFUSAL.get(orchestrationCodeOf(error) ?? '') ?? null
}

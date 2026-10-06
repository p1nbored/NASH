import { translate } from '@/i18n/i18n'
import type {
  RouteBlocker,
  RouteBlockerDetail,
  RouteBlockerReason
} from '../../../../shared/clef/clef-route-contract'

function reasonText(reason: RouteBlockerReason): string {
  switch (reason) {
    case 'classifier_unavailable':
      return translate(
        'auto.components.settings.clef.verification.blockers.classifierUnavailable',
        'Clef could not be used'
      )
    case 'invalid_output':
      return translate(
        'auto.components.settings.clef.verification.blockers.invalidOutput',
        "Clef's answer was not valid"
      )
    case 'missing_inputs':
      return translate(
        'auto.components.settings.clef.verification.blockers.missingInputs',
        'The task needs clarification'
      )
    case 'ambiguous':
      return translate(
        'auto.components.settings.clef.verification.blockers.ambiguous',
        'The answer was ambiguous'
      )
    case 'no_eligible_profile':
      return translate(
        'auto.components.settings.clef.verification.blockers.noEligibleProfile',
        'No eligible profile'
      )
    case 'launch_blocked':
      return translate(
        'auto.components.settings.clef.verification.blockers.launchBlocked',
        'The run could not start'
      )
  }
}

// Why a record of thunks: the type demands every detail, and translate runs only when read.
const DETAIL_TEXT: Readonly<Record<RouteBlockerDetail, () => string>> = {
  not_configured: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.notConfigured',
      'the credentials are not configured'
    ),
  clef_identity_unpinned: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.identityUnpinned',
      'the response model is not pinned'
    ),
  transient_exhausted: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.transientExhausted',
      'temporary failures used up the retries'
    ),
  quota_exhausted: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.quotaExhausted',
      'the Clef quota is used up'
    ),
  budget_exhausted: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.budgetExhausted',
      'no further attempt was allowed'
    ),
  auth_or_account: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.authOrAccount',
      'the credentials or account were rejected'
    ),
  model_unavailable: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.modelUnavailable',
      'the Clef model is unavailable'
    ),
  request_rejected: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.requestRejected',
      'Clef rejected the request'
    ),
  data_boundary_forbids: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.dataBoundary',
      'the data boundary does not allow this content'
    ),
  possible_truncation: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.possibleTruncation',
      'the answer may have been cut off'
    ),
  model_identity_mismatch: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.identityMismatch',
      'a different model answered than the pinned one'
    ),
  interrupted: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.interrupted',
      'the call was interrupted'
    ),
  estimate_exceeded: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.estimateExceeded',
      'the request size was outside the allowed bounds'
    ),
  contract_unverified: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.contractUnverified',
      'the answer format is not verified'
    ),
  response_schema_violation: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.schemaViolation',
      'the answer did not match the response schema'
    ),
  low_margin: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.lowMargin',
      'the leading answer did not win by enough'
    ),
  needs_clarification: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.needsClarification',
      'the task does not say what kind of work it is'
    ),
  choice_outside_legal_set: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.choiceOutside',
      'the answer chose an option that was not offered'
    ),
  inconsistent_type_profile: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.inconsistentTypeProfile',
      'the task type and profile do not match'
    ),
  required_profile_unavailable: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.requiredProfile',
      'the required profile is unavailable'
    ),
  non_english_objective: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.nonEnglish',
      'the objective is not in English'
    ),
  routing_in_progress: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.inProgress',
      'a classification is already in progress'
    ),
  empty_set: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.emptySet',
      'no option was eligible'
    ),
  inconsistent_delegation: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.inconsistentDelegation',
      'delegation was asked for work the coordinator keeps'
    ),
  coordinator_route_unavailable: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.coordinatorRoute',
      'the coordinator route is unavailable'
    ),
  launch_refused: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.launchRefused',
      'the launch was refused'
    ),
  launch_unverifiable: () =>
    translate(
      'auto.components.settings.clef.verification.blockers.launchUnverifiable',
      'the launch could not be verified'
    )
}

/** A failed call's blocker as a short reason and the detail that caused it. */
export function clefBlockerMessage(blocker: RouteBlocker): { reason: string; detail: string } {
  return { reason: reasonText(blocker.reason), detail: DETAIL_TEXT[blocker.detail]() }
}

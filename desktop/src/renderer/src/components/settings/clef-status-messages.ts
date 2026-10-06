import { translate } from '@/i18n/i18n'
import type { RoutingStatus } from '../../../../shared/clef/clef-route-contract'
import type { ClefProfileProblem } from '../../../../shared/clef/clef-verification-view'

export type ClefStatusMessage = { label: string; detail: string }

/** The Clef gate's status as a short label and one sentence on what to do about it. */
export function clefRoutingStatusMessage(status: RoutingStatus): ClefStatusMessage {
  switch (status) {
    case 'not_configured':
      return {
        label: translate(
          'auto.components.settings.clef.verification.status.notConfigured',
          'Not configured'
        ),
        detail: translate(
          'auto.components.settings.clef.verification.status.notConfiguredDetail',
          'Save the API token and account ID first.'
        )
      }
    case 'sealing_unavailable':
      return {
        label: translate(
          'auto.components.settings.clef.verification.status.sealingUnavailable',
          'Sealing unavailable'
        ),
        detail: translate(
          'auto.components.settings.clef.verification.status.sealingUnavailableDetail',
          'This system cannot seal credentials, so Clef cannot be used.'
        )
      }
    case 'contract_unverified':
      return {
        label: translate(
          'auto.components.settings.clef.verification.status.contractUnverified',
          'Waiting for verification'
        ),
        detail: translate(
          'auto.components.settings.clef.verification.status.contractUnverifiedDetail',
          "Run Verify to check Clef's answer format for the current question bundle."
        )
      }
    case 'identity_unpinned':
      return {
        label: translate(
          'auto.components.settings.clef.verification.status.identityUnpinned',
          'Response model not pinned'
        ),
        detail: translate(
          'auto.components.settings.clef.verification.status.identityUnpinnedDetail',
          'The answer format is verified, but no response model is pinned. Verify again and pin a report that names the model.'
        )
      }
    case 'ready':
      return {
        label: translate('auto.components.settings.clef.verification.status.ready', 'Ready'),
        detail: translate(
          'auto.components.settings.clef.verification.status.readyDetail',
          'Clef can classify tasks.'
        )
      }
    case 'unreachable':
      return {
        label: translate(
          'auto.components.settings.clef.verification.status.unreachable',
          'Unreachable'
        ),
        detail: translate(
          'auto.components.settings.clef.verification.status.unreachableDetail',
          'The latest calls could not reach Clef.'
        )
      }
    case 'circuit_open':
      return {
        label: translate(
          'auto.components.settings.clef.verification.status.circuitOpen',
          'Paused after failures'
        ),
        detail: translate(
          'auto.components.settings.clef.verification.status.circuitOpenDetail',
          'Calls are paused after repeated failures and resume on their own.'
        )
      }
    case 'quota_latched':
      return {
        label: translate(
          'auto.components.settings.clef.verification.status.quotaLatched',
          'Quota used up'
        ),
        detail: translate(
          'auto.components.settings.clef.verification.status.quotaLatchedDetail',
          'Clef reported that its quota is used up; calls resume after 00:00 UTC.'
        )
      }
    case 'auth_failed':
      return {
        label: translate(
          'auto.components.settings.clef.verification.status.authFailed',
          'Credentials rejected'
        ),
        detail: translate(
          'auto.components.settings.clef.verification.status.authFailedDetail',
          'Clef rejected the saved credentials. Save new ones above.'
        )
      }
  }
}

/** Why a verification report cannot become the pinned profile. */
export function clefProfileProblemMessage(problem: ClefProfileProblem): string {
  switch (problem) {
    case 'http_status':
      return translate(
        'auto.components.settings.clef.verification.problems.httpStatus',
        'Clef did not answer with HTTP 200.'
      )
    case 'envelope_unrecognized':
      return translate(
        'auto.components.settings.clef.verification.problems.envelopeUnrecognized',
        'The response envelope has an unknown shape.'
      )
    case 'envelope_not_successful':
      return translate(
        'auto.components.settings.clef.verification.problems.envelopeNotSuccessful',
        'The response envelope reports a failure.'
      )
    case 'response_model_unobserved':
      return translate(
        'auto.components.settings.clef.verification.problems.responseModelUnobserved',
        'The response does not name the model that answered.'
      )
    case 'response_model_disallowed':
      return translate(
        'auto.components.settings.clef.verification.problems.responseModelDisallowed',
        'The response names a model that is not allowed.'
      )
    case 'answer_keys_mismatch':
      return translate(
        'auto.components.settings.clef.verification.problems.answerKeysMismatch',
        'The answers do not match the questions that were asked.'
      )
    case 'option_ids_not_echoed':
      return translate(
        'auto.components.settings.clef.verification.problems.optionIdsNotEchoed',
        'The answers do not repeat the option IDs exactly.'
      )
    case 'probability_out_of_range':
      return translate(
        'auto.components.settings.clef.verification.problems.probabilityOutOfRange',
        'A probability is outside 0 to 1.'
      )
    case 'probability_sum_out_of_tolerance':
      return translate(
        'auto.components.settings.clef.verification.problems.probabilitySum',
        'The probabilities of a question do not add up to 1.'
      )
    case 'usage_missing':
      return translate(
        'auto.components.settings.clef.verification.problems.usageMissing',
        'The response does not report token usage.'
      )
    case 'pin_invalid':
      return translate(
        'auto.components.settings.clef.verification.problems.pinInvalid',
        'The report does not make a valid profile.'
      )
  }
}

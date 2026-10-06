import { ZodError } from 'zod'
import { translate } from '@/i18n/i18n'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'

export { clefBlockerMessage } from './clef-blocker-messages'
export { clefProfileProblemMessage, clefRoutingStatusMessage } from './clef-status-messages'

function verifierMessage(code: string): string | null {
  switch (code) {
    case 'workbench_clef_credentials_missing':
      return translate(
        'auto.components.settings.clef.verification.errors.credentialsMissing',
        'Save the Clef API token and account ID before verifying.'
      )
    case 'workbench_clef_credentials_unsealed':
      return translate(
        'auto.components.settings.clef.verification.errors.credentialsUnsealed',
        'The saved credentials are not sealed by the system, so they are not used. Clear them and save again.'
      )
    case 'workbench_clef_auth_failed':
      return translate(
        'auto.components.settings.clef.verification.errors.authFailed',
        'Clef rejected the saved credentials. Save new credentials before verifying.'
      )
    case 'workbench_clef_quota_latched':
      return translate(
        'auto.components.settings.clef.verification.errors.quotaLatched',
        'Clef reported that its quota is used up. Verify is paused until 00:00 UTC.'
      )
    case 'workbench_clef_circuit_open':
      return translate(
        'auto.components.settings.clef.verification.errors.circuitOpen',
        'Clef calls are paused after repeated failures. Try again in a few minutes.'
      )
    case 'workbench_clef_verification_in_progress':
      return translate(
        'auto.components.settings.clef.verification.errors.inProgress',
        'A verification is already running.'
      )
    case 'workbench_clef_request_invalid':
      return translate(
        'auto.components.settings.clef.verification.errors.requestInvalid',
        'The verification request could not be prepared, so nothing was sent.'
      )
    default:
      return null
  }
}

function pinMessage(code: string): string | null {
  switch (code) {
    case 'workbench_clef_report_unconfirmed':
      return translate(
        'auto.components.settings.clef.verification.errors.reportUnconfirmed',
        'That report is no longer the latest one. Run Verify again before pinning.'
      )
    case 'workbench_clef_report_not_pinnable':
      return translate(
        'auto.components.settings.clef.verification.errors.reportNotPinnable',
        'That report cannot be pinned.'
      )
    case 'workbench_clef_profile_write_failed':
      return translate(
        'auto.components.settings.clef.verification.errors.profileWriteFailed',
        'The profile could not be saved. Pin again.'
      )
    default:
      return null
  }
}

function availabilityMessage(code: string): string {
  switch (code) {
    case 'workbench_clef_unavailable':
      return translate(
        'auto.components.settings.clef.verification.errors.clefUnavailable',
        'Clef verification is not available right now.'
      )
    case 'workbench_routing_not_configured':
      return translate(
        'auto.components.settings.clef.verification.errors.routingNotConfigured',
        'Clef verification is not available in this session.'
      )
    case 'workbench_forbidden':
      return translate(
        'auto.components.settings.clef.verification.errors.forbidden',
        'Only the desktop app on this computer can verify Clef.'
      )
    case 'method_not_found':
      return translate(
        'auto.components.settings.clef.verification.errors.notConnected',
        'Clef verification is not connected in this build.'
      )
    default:
      return translate(
        'auto.components.settings.clef.verification.errors.callFailed',
        'The verification request did not complete. Check the status and try again.'
      )
  }
}

/** For Verify, Pin and the status read; never repeats the raw error text. */
export function clefVerificationCallErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return translate(
      'auto.components.settings.clef.verification.errors.invalidResponse',
      'The app returned a verification answer this screen cannot read.'
    )
  }
  const code = error instanceof RuntimeRpcCallError ? error.code : ''
  return verifierMessage(code) ?? pinMessage(code) ?? availabilityMessage(code)
}

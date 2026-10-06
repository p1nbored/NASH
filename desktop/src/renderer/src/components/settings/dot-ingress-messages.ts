import { ZodError } from 'zod'
import { translate } from '@/i18n/i18n'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import type { WORKBENCH_DOT_INGRESS_FAILURES } from '../../../../shared/rpc-contract/workbench-dot-ingress-params'

export type DotIngressFailure = (typeof WORKBENCH_DOT_INGRESS_FAILURES)[number]

/** Why the endpoint is not listening, from the control port's coarse failure code. */
export function dotIngressFailureMessage(failure: DotIngressFailure): string {
  switch (failure) {
    case 'listen_failed':
      return translate(
        'auto.components.settings.dotIngress.failures.listenFailed',
        'The app could not open the local endpoint for dot. Turn the switch off and on to try again, or restart the app.'
      )
    case 'metadata_invalid':
      return translate(
        'auto.components.settings.dotIngress.failures.metadataInvalid',
        'The app could not prepare the connection details for dot, so it closed the endpoint.'
      )
    case 'metadata_write_failed':
      return translate(
        'auto.components.settings.dotIngress.failures.metadataWriteFailed',
        'The app could not save the connection details file for dot, so it closed the endpoint.'
      )
    case 'metadata_not_secured':
      return translate(
        'auto.components.settings.dotIngress.failures.metadataNotSecured',
        'The app could not restrict access to the connection details file, so it removed the file and closed the endpoint.'
      )
  }
}

function refusalForCode(code: string | null): string {
  switch (code) {
    case 'method_not_found':
      return translate(
        'auto.components.settings.dotIngress.refusals.notConnected',
        'The dot settings are not connected in this build yet, so they cannot be shown or changed.'
      )
    case 'workbench_forbidden':
      return translate(
        'auto.components.settings.dotIngress.refusals.forbidden',
        'Only the desktop app on this computer can read or change the dot settings.'
      )
    // Why "saved": only the switch change can meet this code, after it has written the switch.
    case 'workbench_dot_ingress_unavailable':
      return translate(
        'auto.components.settings.dotIngress.refusals.interfaceUnavailable',
        'The switch was saved, but the dot interface is not available in this session, so the endpoint did not change. Restart the app and check again.'
      )
    case 'unsupported_host':
      return translate(
        'auto.components.settings.dotIngress.refusals.unsupportedHost',
        'Only local workspaces on this computer can be enabled for dot. SSH, WSL and remote workspaces are not supported.'
      )
    case 'workbench_workspace_unavailable':
      return translate(
        'auto.components.settings.dotIngress.refusals.workspaceUnavailable',
        'The app could not confirm this workspace as a local workspace, so nothing was changed.'
      )
    case 'dot_workspace_unknown':
      return translate(
        'auto.components.settings.dotIngress.refusals.workspaceUnknown',
        'This workspace is no longer in the list for dot. The list was refreshed.'
      )
    case 'dot_recovery_required':
      return translate(
        'auto.components.settings.dotIngress.refusals.recoveryRequired',
        'The stored dot settings need recovery, so nothing was changed.'
      )
    case 'dot_transaction_unavailable':
      return translate(
        'auto.components.settings.dotIngress.refusals.busy',
        'The settings store was busy, so nothing was changed. Try again.'
      )
    case 'invalid_argument':
    case 'dot_invalid_input':
      return translate(
        'auto.components.settings.dotIngress.refusals.invalidValue',
        'The app refused this value as invalid, so nothing was changed.'
      )
    case null:
    default:
      return translate(
        'auto.components.settings.dotIngress.refusals.callFailed',
        'The dot settings request did not complete. The current state is shown.'
      )
  }
}

/** For a call that did not return settings; never repeats the raw error text or code. */
export function dotIngressCallErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return translate(
      'auto.components.settings.dotIngress.refusals.invalidResponse',
      'The app returned dot settings this screen cannot read.'
    )
  }
  return refusalForCode(error instanceof RuntimeRpcCallError ? error.code : null)
}

import { translate } from '@/i18n/i18n'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-client'
import type { WorkbenchError } from './workbench-rpc-error'

const STOP_REFUSED = 'workbench_run_stop_refused'

function stopCodeOf(error: RuntimeRpcCallError): string | null {
  const data = error.response.error.data
  if (typeof data !== 'object' || data === null || !('stopCode' in data)) {
    return null
  }
  return typeof data.stopCode === 'string' ? data.stopCode : null
}

/** Copy per primary-session stop refusal; null keeps the server text for a code this build does not know. */
function stopRefusalMessage(stopCode: string | null): string | null {
  switch (stopCode) {
    case 'autopilot_owner_starting':
      return translate(
        'workbench.runs.stopRefused.starting',
        'The session is still starting. Stop the run again once it is running.'
      )
    case 'autopilot_owner_identity_unverified':
      return translate(
        'workbench.runs.stopRefused.identityUnverified',
        "The terminal could not be matched to this run's session, so nothing was stopped. Close the session's terminal tab and try again."
      )
    case 'autopilot_invalid_reason':
      return translate(
        'workbench.runs.stopRefused.invalidReason',
        'The stop request was refused as invalid. Nothing was changed.'
      )
    default:
      return null
  }
}

/** D3: a refused stop names its cause in `data.stopCode`; the message then says what to do next. */
export function withStopRefusalMessage(error: unknown, shown: WorkbenchError): WorkbenchError {
  if (!(error instanceof RuntimeRpcCallError) || error.code !== STOP_REFUSED) {
    return shown
  }
  const message = stopRefusalMessage(stopCodeOf(error))
  return message === null ? shown : { ...shown, message }
}

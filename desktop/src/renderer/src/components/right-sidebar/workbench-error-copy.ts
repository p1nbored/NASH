import { translate } from '@/i18n/i18n'
import { WORKBENCH_VALIDATION_ERROR_CODES as VALIDATION } from '../../../../shared/rpc-contract/workbench-validation-params'

// Why a map: Workbench and D-016 refusals are stable codes main sends for the renderer to word
// (rpc/errors.ts). The code never reaches the visible UI; "Copy details" carries it instead.

const notAllowed = (): string =>
  translate('workbench.error.notAllowed', 'This window is not allowed to do that.')
const workspaceUnavailable = (): string =>
  translate('workbench.error.workspaceUnavailable', 'This workspace is not available here.')
const runGone = (): string => translate('workbench.error.runGone', 'This run no longer exists.')
const sessionNotRunning = (): string =>
  translate('workbench.error.sessionNotRunning', 'The primary session is not running.')
const attemptGone = (): string =>
  translate('workbench.error.attemptGone', 'This attempt no longer exists.')
const invalidInput = (): string =>
  translate('workbench.error.invalidInput', 'The app refused this as invalid.')
const recoveryRequired = (): string =>
  translate(
    'workbench.error.recoveryRequired',
    'The stored records could not be read. Restart the app and try again.'
  )

const MESSAGES = new Map<string, () => string>([
  ['forbidden', notAllowed],
  ['workbench_forbidden', notAllowed],
  ['workbench_workspace_unavailable', workspaceUnavailable],
  ['unsupported_host', workspaceUnavailable],
  ['workbench_run_not_found', runGone],
  ['autopilot_run_not_found', runGone],
  [
    'workbench_run_completed',
    () => translate('workbench.error.runEnded', 'This run has already ended.')
  ],
  [
    'workbench_run_stop_refused',
    () =>
      translate(
        'workbench.error.stopRefused',
        'The run could not be stopped now. Nothing was changed.'
      )
  ],
  [
    'workbench_run_stop_unconfirmed',
    () =>
      translate(
        'workbench.error.stopUnconfirmed',
        'The stop could not be confirmed, so the run is still open. Close its terminal tab and try again.'
      )
  ],
  ['autopilot_owner_not_live', sessionNotRunning],
  ['autopilot_run_not_live', sessionNotRunning],
  [
    'autopilot_primary_session_not_configured',
    () =>
      translate('workbench.error.runControlUnavailable', 'Run control is not available right now.')
  ],
  [
    'autopilot_permission_relay_unavailable',
    () =>
      translate(
        'workbench.error.permissionsUnavailable',
        'Permission prompts are not available right now.'
      )
  ],
  [
    'autopilot_validation_conflict',
    () => translate('workbench.decisions.conflict', 'This result was already decided.')
  ],
  [
    'autopilot_validation_not_found',
    () =>
      translate('workbench.decisions.notFound', 'This result is no longer waiting for a decision.')
  ],
  [
    VALIDATION.unavailable,
    () =>
      translate(
        'workbench.validation.unavailable',
        'Task validation is not available in this session.'
      )
  ],
  [
    VALIDATION.passRunning,
    () =>
      translate(
        'workbench.validation.passRunning',
        'A validation pass is already running. Check again when it finishes.'
      )
  ],
  [
    VALIDATION.passFailed,
    () => translate('workbench.error.checkFailed', 'The check could not finish. Try again.')
  ],
  ['workbench_attempt_not_found', attemptGone],
  ['autopilot_attempt_not_found', attemptGone],
  [
    'workbench_transcript_refused',
    () =>
      translate(
        'workbench.error.transcriptRefused',
        'The transcript file could not be verified, so it was not read.'
      )
  ],
  [
    'workbench_request_not_found',
    () => translate('workbench.error.requestGone', 'This request no longer exists.')
  ],
  [
    'workbench_request_handed_off',
    () =>
      translate(
        'workbench.error.requestHandedOff',
        'This request has started its run. Stop the run to cancel it.'
      )
  ],
  [
    'workbench_revision_conflict',
    () =>
      translate(
        'workbench.error.requestChanged',
        'This request changed in the meantime. Try again.'
      )
  ],
  [
    'workbench_idempotency_conflict',
    () =>
      translate(
        'workbench.error.requestReused',
        'This request was already sent with different text.'
      )
  ],
  [
    'workbench_capacity_exceeded',
    () => translate('workbench.error.capacity', 'Too many requests are waiting. Try again later.')
  ],
  ['workbench_invalid_input', invalidInput],
  ['autopilot_invalid_input', invalidInput],
  ['invalid_argument', invalidInput],
  ['workbench_recovery_required', recoveryRequired],
  ['autopilot_recovery_required', recoveryRequired],
  [
    'workbench_transaction_unavailable',
    () => translate('workbench.error.busy', 'The app is busy. Try again.')
  ],
  [
    'method_not_found',
    () =>
      translate(
        'workbench.error.unsupported',
        'This version of the app does not support this action.'
      )
  ],
  ['invalid_response', () => unexpectedResponseMessage()]
])

/** Every code with its own sentence; exported for the mapping tests. */
export const WORKBENCH_MAPPED_ERROR_CODES: readonly string[] = [...MESSAGES.keys()]

/** One short sentence for a known code; null for a code this build does not word. */
export function workbenchErrorMessage(code: string): string | null {
  return MESSAGES.get(code)?.() ?? null
}

export function genericErrorMessage(): string {
  return translate('workbench.error.generic', 'Something went wrong.')
}

export function unexpectedResponseMessage(): string {
  return translate('workbench.error.unexpectedResponse', 'The app returned an unexpected response.')
}

// Why only launch details: D-016's launch door blocks a request with exactly these three.
const LAUNCH_BLOCKERS = new Map<string, () => string>([
  [
    'coordinator_route_unavailable',
    () =>
      translate(
        'workbench.requests.launch.noModel',
        'No model is available to start this run. Check Task routing in Settings.'
      )
  ],
  [
    'launch_refused',
    () => translate('workbench.requests.launch.refused', 'The run could not be started.')
  ],
  [
    'launch_unverifiable',
    () =>
      translate(
        'workbench.requests.launch.unverifiable',
        'A run was created, but its start could not be confirmed.'
      )
  ]
])

/** Why a request could not start a run, in words; the reason and detail codes go to details. */
export function launchBlockerMessage(blocker: { reason: string; detail: string }): string {
  const known =
    blocker.reason === 'launch_blocked' ? LAUNCH_BLOCKERS.get(blocker.detail) : undefined
  return (
    known?.() ??
    translate('workbench.requests.launch.generic', 'This request could not start a run.')
  )
}

import { translate } from '@/i18n/i18n'
import type {
  DotRemoteReconnectReason,
  WorkbenchDotRemotePairingView,
  WorkbenchDotRemoteStatusView
} from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { formatRoutingTime } from './routing-table-time'
import type { SettingsStatusTone } from './settings-status-label'

// Plain English for the remote access status the app reports. "Connected" means the app reaches the
// Site's mailbox; nothing here claims that dot itself is connected (STYLEGUIDE: no overclaiming).

type Status = WorkbenchDotRemoteStatusView
type Protection = Status['serviceToken']
type SyncFailure = NonNullable<Status['syncFailure']>

/** The status and warning label while polls keep failing on this computer. */
export function dotRemoteSyncFailingLabel(): string {
  return translate('auto.components.settings.dotRemote.pill.syncFailing', 'Sync failing')
}

/** How many polls failed in a row and since when; the last code goes to the details. */
export function dotRemoteSyncFailureMessage(failure: SyncFailure): string {
  return translate(
    'auto.components.settings.dotRemote.status.syncFailingPlain',
    '{{failures}} sync attempts in a row failed on this computer, the first at {{time}}. The app keeps trying.',
    {
      failures: failure.consecutiveFailures,
      time: formatRoutingTime(failure.since)
    }
  )
}

/** The failing sync's code and timing for "Copy details"; never shown on screen. */
export function dotRemoteSyncFailureDetails(failure: SyncFailure): string {
  return [
    `last_code: ${failure.lastCode}`,
    `consecutive_failures: ${failure.consecutiveFailures}`,
    `since: ${failure.since}`
  ].join('\n')
}

export function dotRemotePill(status: Status | null): {
  label: string
  tone: SettingsStatusTone
} {
  switch (status?.state) {
    case undefined:
      return {
        label: translate('auto.components.settings.dotRemote.pill.unavailable', 'Unavailable'),
        tone: 'warning'
      }
    case 'off':
      return {
        label: translate('auto.components.settings.dotRemote.pill.off', 'Off'),
        tone: 'neutral'
      }
    case 'unpaired':
      return {
        label: translate('auto.components.settings.dotRemote.pill.unpaired', 'Not paired'),
        tone: 'warning'
      }
    case 'pairing':
      return {
        label: translate('auto.components.settings.dotRemote.pill.pairing', 'Pairing'),
        tone: 'neutral'
      }
    case 'connected':
      // Why: a store failure on this computer leaves the mailbox reading connected while nothing syncs.
      return status.syncFailure
        ? { label: dotRemoteSyncFailingLabel(), tone: 'warning' }
        : {
            label: translate('auto.components.settings.dotRemote.pill.connected', 'Connected'),
            tone: 'success'
          }
    case 'offline':
      return {
        label: translate('auto.components.settings.dotRemote.pill.offline', 'Offline'),
        tone: 'warning'
      }
    case 'reconnect_needed':
      return {
        label: translate('auto.components.settings.dotRemote.pill.reconnect', 'Reconnect needed'),
        tone: 'warning'
      }
    case 'pair_again':
      return {
        label: translate('auto.components.settings.dotRemote.pill.pairAgain', 'Pair again'),
        tone: 'warning'
      }
  }
}

/** One line for the state; a stop reason has its own callout. */
export function dotRemoteStateDetail(status: Status): string {
  switch (status.state) {
    case 'off':
      return translate(
        'auto.components.settings.dotRemote.detail.off',
        'Off. The app does not check the Site and sends it nothing.'
      )
    case 'unpaired':
      return translate(
        'auto.components.settings.dotRemote.detail.unpaired',
        'On, but this computer is not paired with the Site yet.'
      )
    case 'pairing':
      return translate(
        'auto.components.settings.dotRemote.detail.pairing',
        'Waiting for the Site owner to approve the pairing code.'
      )
    case 'connected':
      return translate(
        'auto.components.settings.dotRemote.detail.connected',
        'Connected to the Site mailbox. The app cannot tell whether dot is connected to the Site.'
      )
    case 'offline':
      return translate(
        'auto.components.settings.dotRemote.detail.offline',
        'Offline. The app has no working connection to the Site right now and keeps trying.'
      )
    case 'reconnect_needed':
      return translate(
        'auto.components.settings.dotRemote.detail.reconnect',
        'Stopped. The app does not check the Site until a current access token is saved.'
      )
    case 'pair_again':
      return translate(
        'auto.components.settings.dotRemote.detail.pairAgain',
        'Stopped. The app does not check the Site until this computer is paired again.'
      )
  }
}

function tokenStopMessage(reason: 'service_token_missing' | 'service_token_rejected'): string {
  return reason === 'service_token_missing'
    ? translate(
        'auto.components.settings.dotRemote.reconnect.tokenMissing',
        'No usable Site access token is stored. Paste the token again.'
      )
    : translate(
        'auto.components.settings.dotRemote.reconnect.tokenRejected',
        "The Site refused the access token; it may have been replaced. Paste the current token from the Site's settings."
      )
}

/** Why remote access stopped and what resumes it: a current token, or a new pairing. */
export function dotRemoteReconnectMessage(reason: DotRemoteReconnectReason): string {
  switch (reason) {
    case 'service_token_missing':
    case 'service_token_rejected':
      return tokenStopMessage(reason)
    case 'session_rejected':
      return translate(
        'auto.components.settings.dotRemote.reconnect.sessionRejected',
        "The Site refused this computer's session. Pair again to resume."
      )
    case 'session_expired':
      return translate(
        'auto.components.settings.dotRemote.reconnect.sessionExpired',
        'The session with the Site expired before it could be renewed. Pair again to resume.'
      )
    case 'session_ended':
      return translate(
        'auto.components.settings.dotRemote.reconnect.sessionEnded',
        'The session with the Site ended and could not be resumed. Pair again to resume.'
      )
    case 'pairing_revoked':
      return translate(
        'auto.components.settings.dotRemote.reconnect.pairingRevoked',
        'The pairing was revoked. Pair again to resume.'
      )
    case 'pairing_expired':
      return translate(
        'auto.components.settings.dotRemote.reconnect.pairingExpired',
        'The pairing reached the end of its lifetime on the Site. Pair again to resume.'
      )
    case 'device_credential_reused':
      return translate(
        'auto.components.settings.dotRemote.reconnect.credentialReused',
        "The Site saw this computer's replaced credential used again and revoked the pairing to protect it. Pair again to resume."
      )
    case 'device_credential_invalid':
      return translate(
        'auto.components.settings.dotRemote.reconnect.credentialInvalid',
        "The Site did not accept this computer's credential. Pair again to resume."
      )
    case 'device_credential_unsaved':
      return translate(
        'auto.components.settings.dotRemote.reconnect.credentialUnsaved',
        "The app could not store this computer's credential securely, so the pairing was not kept. Pair again to resume."
      )
  }
}

/** "Token saved" for a stored token; a reason for a token the app will not use; null when absent. */
export function dotRemoteTokenProtectionMessage(protection: Protection): string | null {
  switch (protection) {
    case 'absent':
      return null
    case 'sealed':
      return translate('auto.components.settings.dotRemote.token.saved', 'Token saved')
    case 'plaintext_refused':
      return translate(
        'auto.components.settings.dotRemote.token.plaintextRefusedPlain',
        'A stored token was not protected, so the app will not use it. Paste the token again.'
      )
    case 'sealing_unavailable':
      return translate(
        'auto.components.settings.dotRemote.token.sealingUnavailablePlain',
        'This computer cannot store the token safely, so remote access cannot connect.'
      )
  }
}

export function dotRemotePairingEndMessage(
  state: WorkbenchDotRemotePairingView['state']
): string | null {
  switch (state) {
    case 'idle':
    case 'waiting_for_approval':
      return null
    case 'paired':
      return translate(
        'auto.components.settings.dotRemote.pairing.approved',
        'Pairing approved. This computer now checks the Site mailbox.'
      )
    case 'denied':
      return translate(
        'auto.components.settings.dotRemote.pairing.denied',
        'The pairing was denied on the Site. Start pairing again if that was a mistake.'
      )
    case 'expired':
      return translate(
        'auto.components.settings.dotRemote.pairing.expired',
        'The code expired before it was approved. Start pairing again for a new code.'
      )
    case 'failed':
      return translate(
        'auto.components.settings.dotRemote.pairing.failed',
        'The pairing could not be completed because the Site no longer accepts this code. Start pairing again.'
      )
  }
}

/** When the live pairing was approved and, when the Site set one, when it ends. */
export function dotRemotePairedLine(pairing: Status['pairing']): string | null {
  if (pairing === null) {
    return null
  }
  const pairedAt = formatRoutingTime(pairing.pairedAt)
  return pairing.pairedUntil
    ? translate(
        'auto.components.settings.dotRemote.pairing.pairedUntil',
        'Paired until {{until}}. Approved on {{time}}.',
        { time: pairedAt, until: formatRoutingTime(pairing.pairedUntil) }
      )
    : translate('auto.components.settings.dotRemote.pairing.pairedAt', 'Paired on {{time}}.', {
        time: pairedAt
      })
}

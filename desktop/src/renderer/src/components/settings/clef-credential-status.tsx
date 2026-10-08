import { translate } from '@/i18n/i18n'
import type { ClefCredentialStatus } from '../../../../shared/clef/clef-credential-contract'
import type { WorkbenchRoutingStatusView } from '../../../../shared/clef/workbench-routing-status-view'
import { clefRoutingStatusMessage, clefRoutingTone } from './clef-status-messages'
import { SettingsStatusLabel, type SettingsStatusTone } from './settings-status-label'

export type ClefHeaderStatus = { tone: SettingsStatusTone; label: string }

export function clefCredentialsComplete(status: ClefCredentialStatus | null): boolean {
  return (
    status !== null &&
    status.tokenPresent &&
    status.accountPresent &&
    status.protection === 'sealed'
  )
}

/**
 * Clef's one-line status. Credentials come first, since nothing works without them; once they are
 * saved, the routing gate's own status says whether Clef can sort tasks. Saved is never "ready".
 */
export function clefHeaderStatus(
  credentials: ClefCredentialStatus | null,
  routing: WorkbenchRoutingStatusView | null
): ClefHeaderStatus {
  if (credentials === null) {
    return {
      tone: 'warning',
      label: translate('auto.components.settings.clef.status.unavailable', 'Status unavailable')
    }
  }
  if (credentials.protection === 'plaintext_refused') {
    return {
      tone: 'warning',
      label: translate('auto.components.settings.clef.status.notProtected', 'Not protected')
    }
  }
  if (credentials.protection === 'sealing_unavailable') {
    return { tone: 'error', label: clefRoutingStatusMessage('sealing_unavailable').label }
  }
  if (!credentials.tokenPresent && !credentials.accountPresent) {
    return {
      tone: 'neutral',
      label: translate('auto.components.settings.clef.status.notSetUp', 'Not set up')
    }
  }
  if (!credentials.tokenPresent || !credentials.accountPresent) {
    return {
      tone: 'warning',
      label: translate('auto.components.settings.clef.status.incomplete', 'Incomplete')
    }
  }
  if (routing === null) {
    return {
      tone: 'neutral',
      label: translate('auto.components.settings.clef.status.saved', 'Credentials saved')
    }
  }
  return {
    tone: clefRoutingTone(routing.status),
    label: clefRoutingStatusMessage(routing.status).label
  }
}

/** What is wrong with the stored credentials, if anything; null when they are fine or absent. */
function credentialProblem(status: ClefCredentialStatus | null): string | null {
  if (status === null) {
    return translate(
      'auto.components.settings.clef.status.readFailed',
      'Could not read whether Clef credentials are stored.'
    )
  }
  switch (status.protection) {
    case 'plaintext_refused':
      return translate(
        'auto.components.settings.clef.status.notProtectedDetail',
        'The saved credentials are not protected, so NASH does not use them. Clear them and save again.'
      )
    case 'sealing_unavailable':
      return clefRoutingStatusMessage('sealing_unavailable').detail
    default:
      break
  }
  if (status.tokenPresent && !status.accountPresent) {
    return translate(
      'auto.components.settings.clef.status.accountMissing',
      'API token saved; account ID missing'
    )
  }
  if (status.accountPresent && !status.tokenPresent) {
    return translate(
      'auto.components.settings.clef.status.tokenMissing',
      'Account ID saved; API token missing'
    )
  }
  return null
}

/** A credential problem as an icon and a sentence, never colour alone. */
export function ClefCredentialProblem({
  status
}: {
  status: ClefCredentialStatus | null
}): React.JSX.Element | null {
  const problem = credentialProblem(status)
  if (problem === null) {
    return null
  }
  const tone = status?.protection === 'sealing_unavailable' ? 'error' : 'warning'
  return <SettingsStatusLabel tone={tone} label={problem} />
}

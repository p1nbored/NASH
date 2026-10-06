import { KeyRound, Shield, ShieldAlert, ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { ClefCredentialStatus } from '../../../../shared/clef/clef-credential-contract'
import type { IntegrationCardStatusTone } from './integration-card-shell'

/** The card's status pill. Saved is never "connected": routing is wired and verified elsewhere. */
export function clefCardStatus(status: ClefCredentialStatus | null): {
  label: string
  tone: IntegrationCardStatusTone
} {
  if (status === null) {
    return {
      label: translate('auto.components.settings.clef.status.unavailable', 'Status unavailable'),
      tone: 'attention'
    }
  }
  if (status.protection === 'plaintext_refused') {
    return {
      label: translate('auto.components.settings.clef.status.notSealedPill', 'Not sealed'),
      tone: 'attention'
    }
  }
  if (status.protection === 'sealing_unavailable') {
    return {
      label: translate(
        'auto.components.settings.clef.status.sealingUnavailablePill',
        'Sealing unavailable'
      ),
      tone: 'attention'
    }
  }
  if (status.tokenPresent && status.accountPresent) {
    return {
      label: translate('auto.components.settings.clef.status.saved', 'Credentials saved'),
      tone: 'neutral'
    }
  }
  if (status.tokenPresent || status.accountPresent) {
    return {
      label: translate('auto.components.settings.clef.status.incomplete', 'Incomplete'),
      tone: 'attention'
    }
  }
  return {
    label: translate('auto.components.settings.clef.status.notConfigured', 'Not configured'),
    tone: 'attention'
  }
}

function presenceLabel(status: ClefCredentialStatus): string {
  if (status.tokenPresent && status.accountPresent) {
    return translate(
      'auto.components.settings.clef.status.bothSaved',
      'API token and account ID saved'
    )
  }
  if (status.tokenPresent) {
    return translate(
      'auto.components.settings.clef.status.accountMissing',
      'API token saved; account ID missing'
    )
  }
  if (status.accountPresent) {
    return translate(
      'auto.components.settings.clef.status.tokenMissing',
      'Account ID saved; API token missing'
    )
  }
  return translate(
    'auto.components.settings.clef.status.noneSaved',
    'No API token or account ID saved'
  )
}

function ProtectionLine({ status }: { status: ClefCredentialStatus }): React.JSX.Element {
  switch (status.protection) {
    case 'sealed':
      return (
        <li className="flex items-start gap-2 text-foreground">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {translate(
              'auto.components.settings.clef.status.sealed',
              'Sealed with the OS credential store'
            )}
          </span>
        </li>
      )
    case 'plaintext_refused':
      return (
        <li className="flex items-start gap-2 text-status-warning">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {translate(
              'auto.components.settings.clef.status.notSealed',
              'Not sealed: NASH will not use the stored values. Clear them and save again.'
            )}
          </span>
        </li>
      )
    case 'sealing_unavailable':
      return (
        <li className="flex items-start gap-2 text-status-warning">
          <ShieldOff aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {translate(
              'auto.components.settings.clef.status.sealingUnavailable',
              'Sealing unavailable on this system: credentials cannot be saved or read.'
            )}
          </span>
        </li>
      )
    case 'absent':
      return (
        <li className="flex items-start gap-2 text-muted-foreground">
          <Shield aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{translate('auto.components.settings.clef.status.absent', 'Nothing stored')}</span>
        </li>
      )
  }
}

export function ClefCredentialStatusList({
  status
}: {
  status: ClefCredentialStatus | null
}): React.JSX.Element {
  const listLabel = translate('auto.components.settings.clef.status.listLabel', 'Credential status')
  if (status === null) {
    return (
      <ul aria-label={listLabel} className="space-y-1.5 text-xs">
        <li className="flex items-start gap-2 text-status-warning">
          <ShieldQuestion aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {translate(
              'auto.components.settings.clef.status.readFailed',
              'Could not read whether Clef credentials are stored.'
            )}
          </span>
        </li>
      </ul>
    )
  }
  return (
    <ul aria-label={listLabel} className="space-y-1.5 text-xs">
      <li className="flex items-start gap-2 text-foreground">
        <KeyRound aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>{presenceLabel(status)}</span>
      </li>
      <ProtectionLine status={status} />
    </ul>
  )
}

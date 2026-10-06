import { useState } from 'react'
import { Route, Trash2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { ClefCredentialStatusList, clefCardStatus } from './clef-credential-status'
import { ClefCredentialForm } from './clef-credential-form'
import {
  ClefClearCredentialsDialog,
  clefClearCredentialsLabel
} from './clef-clear-credentials-dialog'
import { ClefVerificationSection } from './clef-verification-section'
import { useClefCredentials } from './use-clef-credentials'

export const CLEF_ROUTING_SECTION_ID = 'integrations-clef-routing'

function storageNote(): string {
  const agent = navigator.userAgent
  if (agent.includes('Windows')) {
    return translate(
      'auto.components.settings.clef.notes.storageWindows',
      'The token is sealed with Windows data protection on this computer and is never shown again.'
    )
  }
  if (agent.includes('Mac')) {
    return translate(
      'auto.components.settings.clef.notes.storageMac',
      'The token is sealed with the macOS Keychain on this computer and is never shown again.'
    )
  }
  return translate(
    'auto.components.settings.clef.notes.storageOther',
    'The token is sealed with the system keyring on this computer and is never shown again.'
  )
}

function ClefCredentialNotes(): React.JSX.Element {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>{storageNote()}</p>
      <p>
        {translate(
          'auto.components.settings.clef.notes.rotate',
          'If this token was pasted into a chat earlier, treat it as exposed: rotate it in the Cloudflare dashboard first, then enter the new token here.'
        )}
      </p>
    </div>
  )
}

export function ClefRoutingCard(): React.JSX.Element {
  const model = useClefCredentials()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const pill = clefCardStatus(model.status)
  const somethingStored =
    model.status !== null && (model.status.tokenPresent || model.status.accountPresent)
  const successMessage = model.notice?.kind === 'success' ? model.notice.message : ''
  const errorMessage = model.notice?.kind === 'error' ? model.notice.message : null

  const confirmClear = (): void => {
    setConfirmOpen(false)
    void model.clear()
  }

  return (
    <IntegrationCardShell
      icon={<Route className="size-5" />}
      name={translate('auto.components.settings.clef.card.name', 'Clef routing')}
      description={translate(
        'auto.components.settings.clef.card.description',
        'Credentials for the Clef classifier on Cloudflare. Clef classifies each task by type and whether to delegate it; the Routing Table picks the model.'
      )}
      checking={model.loading}
      statusLabel={pill.label}
      statusTone={pill.tone}
      settingsSectionId={CLEF_ROUTING_SECTION_ID}
    >
      {model.loading ? null : (
        <IntegrationCardDetails className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <ClefCredentialStatusList status={model.status} />
            {somethingStored ? (
              <Button
                variant="outline"
                size="sm"
                disabled={model.busy}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 aria-hidden="true" />
                {clefClearCredentialsLabel()}
              </Button>
            ) : null}
          </div>
          <ClefCredentialForm busy={model.busy} onSave={model.save} />
          <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {successMessage}
          </div>
          {errorMessage === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {errorMessage}
            </p>
          )}
          <ClefCredentialNotes />
          <ClefVerificationSection />
        </IntegrationCardDetails>
      )}
      <ClefClearCredentialsDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={confirmClear}
      />
    </IntegrationCardShell>
  )
}

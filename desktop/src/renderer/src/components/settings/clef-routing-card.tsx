import { useId, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { ClefCredentialSaveInput } from '../../../../shared/clef/clef-credential-contract'
import { Button } from '../ui/button'
import { ClefAwaitingConfirmation } from './clef-awaiting-confirmation'
import {
  ClefClearCredentialsDialog,
  clefClearCredentialsLabel
} from './clef-clear-credentials-dialog'
import { ClefCredentialForm } from './clef-credential-form'
import {
  ClefCredentialProblem,
  clefCredentialsComplete,
  clefHeaderStatus
} from './clef-credential-status'
import { clefStatusDetails } from './clef-details'
import { ClefVerificationSection } from './clef-verification-section'
import { SettingsAdvancedDisclosure } from './settings-advanced-disclosure'
import { CopyDetailsButton } from './settings-copy-details-button'
import { SettingsStatusLabel } from './settings-status-label'
import { SettingsRow, SettingsSubsectionHeader } from './SettingsFormControls'
import { useClefCredentials } from './use-clef-credentials'
import { useClefVerification } from './use-clef-verification'

export const CLEF_ROUTING_SECTION_ID = 'integrations-clef-routing'

/**
 * Clef (D-016): sorts each task by kind so the choice above applies. One status line, the
 * credentials, and Verify; versions and hashes stay behind Advanced and "Copy details".
 */
export function ClefRoutingCard(): React.JSX.Element {
  const headingId = useId()
  const credentials = useClefCredentials()
  const verification = useClefVerification()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const { status } = credentials
  const header = clefHeaderStatus(status, verification.status)
  const complete = clefCredentialsComplete(status)
  const somethingStored = status !== null && (status.tokenPresent || status.accountPresent)
  const successMessage = credentials.notice?.kind === 'success' ? credentials.notice.message : ''
  const errorMessage = credentials.notice?.kind === 'error' ? credentials.notice.message : null

  // Why the status read after: the verification gate depends on what is stored.
  const save = async (input: ClefCredentialSaveInput): Promise<void> => {
    setReplacing(false)
    await credentials.save(input)
    await verification.refresh()
  }
  const confirmClear = async (): Promise<void> => {
    setConfirmOpen(false)
    setReplacing(false)
    await credentials.clear()
    await verification.refresh()
  }
  const clearButton = (
    <Button
      variant="ghost"
      size="sm"
      disabled={credentials.busy}
      onClick={() => setConfirmOpen(true)}
    >
      {clefClearCredentialsLabel()}
    </Button>
  )

  return (
    <section
      aria-labelledby={headingId}
      data-settings-section={CLEF_ROUTING_SECTION_ID}
      className="space-y-group"
    >
      <SettingsSubsectionHeader
        title={
          <span id={headingId}>
            {translate('auto.components.settings.clef.card.title', 'Clef')}
          </span>
        }
        description={translate(
          'auto.components.settings.clef.card.descriptionPlain',
          'Clef sorts each task by kind, so it goes to the agent chosen for that kind.'
        )}
        action={
          credentials.loading ? null : (
            <SettingsStatusLabel tone={header.tone} label={header.label} />
          )
        }
      />
      {credentials.loading ? null : (
        <>
          <ClefCredentialProblem status={status} />
          {complete && !replacing ? (
            <SettingsRow
              label={translate('auto.components.settings.clef.saved.label', 'Credentials')}
              description={translate(
                'auto.components.settings.clef.saved.description',
                'Saved on this computer. They are never shown again.'
              )}
              control={
                <div className="flex items-center gap-row">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={credentials.busy}
                    onClick={() => setReplacing(true)}
                  >
                    {translate('auto.components.settings.clef.saved.replace', 'Replace')}
                  </Button>
                  {clearButton}
                </div>
              }
            />
          ) : (
            <ClefCredentialForm
              busy={credentials.busy}
              onSave={save}
              onCancel={replacing ? () => setReplacing(false) : undefined}
              extraAction={somethingStored && !replacing ? clearButton : null}
            />
          )}
          <div
            role="status"
            aria-live="polite"
            className="text-meta text-muted-foreground empty:hidden"
          >
            {successMessage}
          </div>
          {errorMessage === null ? null : (
            <p role="alert" className="text-meta text-destructive">
              {errorMessage}
            </p>
          )}
          <ClefVerificationSection model={verification} />
          {verification.status === null ? null : (
            <SettingsAdvancedDisclosure>
              <ClefAwaitingConfirmation bundle={verification.status.bundle} />
              <CopyDetailsButton
                details={() =>
                  verification.status === null ? '' : clefStatusDetails(verification.status)
                }
              />
            </SettingsAdvancedDisclosure>
          )}
        </>
      )}
      <ClefClearCredentialsDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => void confirmClear()}
      />
    </section>
  )
}

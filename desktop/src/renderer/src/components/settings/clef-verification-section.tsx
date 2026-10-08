import { useId } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkbenchRoutingStatusView } from '../../../../shared/clef/workbench-routing-status-view'
import { Button } from '../ui/button'
import { clefPinDetails } from './clef-details'
import { clefRoutingStatusMessage } from './clef-verification-messages'
import { ClefVerificationResult } from './clef-verification-report'
import { formatRoutingTime } from './routing-table-time'
import { CopyDetailsButton } from './settings-copy-details-button'
import { SettingsRow } from './SettingsFormControls'
import type { ClefVerificationModel } from './use-clef-verification'

const PAUSED: ReadonlySet<string> = new Set(['circuit_open', 'quota_latched', 'auth_failed'])

/** Why Verify cannot run now, in the order main's verifier refuses; null when it can. No budget gate. */
function verifyBlock(status: WorkbenchRoutingStatusView | null): string | null {
  if (status === null) {
    return translate(
      'auto.components.settings.clef.verification.blockStatusPlain',
      'The Clef status could not be read.'
    )
  }
  const { credentials } = status
  if (
    credentials.protection !== 'sealed' ||
    !credentials.tokenPresent ||
    !credentials.accountPresent
  ) {
    return translate(
      'auto.components.settings.clef.verification.blockCredentialsPlain',
      'Save the API token and account ID first.'
    )
  }
  if (PAUSED.has(status.status)) {
    return translate(
      'auto.components.settings.clef.verification.blockPaused',
      'Verify is paused: {{reason}}.',
      {
        reason: clefRoutingStatusMessage(status.status).label
      }
    )
  }
  return null
}

/** One sentence on where verification stands; bundle versions and hashes stay in the details. */
function statusLine(status: WorkbenchRoutingStatusView): string {
  const verifiedAgainst = status.profile.verifiedAgainstBundleSha256
  if (verifiedAgainst !== null && verifiedAgainst !== status.bundle.sha256) {
    return translate(
      'auto.components.settings.clef.verification.otherBundlePlain',
      "Clef's questions changed since the last verification. Verify again."
    )
  }
  const detail = clefRoutingStatusMessage(status.status).detail
  const { verifiedAt } = status.profile
  if (!status.profile.present || verifiedAt === null) {
    return detail
  }
  return `${detail} ${translate(
    'auto.components.settings.clef.verification.lastVerified',
    'Last verified {{time}}.',
    { time: formatRoutingTime(verifiedAt) }
  )}`
}

/** Verify Clef's answers with one call, then use the result (D-016, D-020, D-022). */
export function ClefVerificationSection({
  model
}: {
  model: ClefVerificationModel
}): React.JSX.Element {
  const labelId = useId()
  const block = model.loading ? null : verifyBlock(model.status)
  const description = block ?? (model.status === null ? null : statusLine(model.status))

  return (
    <section
      aria-labelledby={labelId}
      data-clef-slot="verification-profile"
      className="space-y-row"
    >
      <SettingsRow
        labelId={labelId}
        label={translate('auto.components.settings.clef.verification.titlePlain', 'Verification')}
        description={description ?? undefined}
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={model.loading || block !== null || model.running !== null}
            onClick={() => void model.verify()}
          >
            {model.running === 'verify' ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <ShieldCheck aria-hidden="true" />
            )}
            {model.running === 'verify'
              ? translate('auto.components.settings.clef.verification.verifying', 'Verifying…')
              : translate('auto.components.settings.clef.verification.verify', 'Verify')}
          </Button>
        }
      />
      {model.statusError === null ? null : (
        <p role="alert" className="text-meta text-destructive">
          {model.statusError}
        </p>
      )}
      {model.error === null ? null : (
        <p role="alert" className="text-meta text-destructive">
          {model.error}
        </p>
      )}
      <div
        role="status"
        aria-live="polite"
        className="text-meta text-muted-foreground empty:hidden"
      >
        {model.pinned
          ? translate(
              'auto.components.settings.clef.verification.pinnedPlain',
              'Result saved. Clef status: {{status}}.',
              { status: clefRoutingStatusMessage(model.pinned.routingStatus).label }
            )
          : ''}
      </div>
      {model.pinned === null ? null : <CopyDetailsButton details={clefPinDetails(model.pinned)} />}
      {model.result === null || model.pinned !== null ? null : (
        <ClefVerificationResult
          result={model.result}
          pinning={model.running === 'pin'}
          onPin={(reportSha256) => void model.pin(reportSha256)}
        />
      )}
    </section>
  )
}

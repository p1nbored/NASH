import { useId } from 'react'
import { FileCheck2, Layers, Loader2, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkbenchRoutingStatusView } from '../../../../shared/clef/workbench-routing-status-view'
import { Button } from '../ui/button'
import { ClefAwaitingConfirmation } from './clef-awaiting-confirmation'
import { clefRoutingStatusMessage } from './clef-verification-messages'
import { ClefVerificationResult } from './clef-verification-report'
import { formatRoutingTime } from './routing-table-time'
import { useClefVerification } from './use-clef-verification'

const PAUSED: ReadonlySet<string> = new Set(['circuit_open', 'quota_latched', 'auth_failed'])

function profileText(status: WorkbenchRoutingStatusView): string {
  const { profile } = status
  if (!profile.present) {
    return translate('auto.components.settings.clef.verification.profileAbsent', 'Not verified')
  }
  if (!profile.responseModelPinned) {
    return translate(
      'auto.components.settings.clef.verification.profileUnpinned',
      'Verified; response model not pinned'
    )
  }
  return translate(
    'auto.components.settings.clef.verification.profilePinned',
    'Pinned · verified {{time}}',
    {
      time: profile.verifiedAt === null ? '?' : formatRoutingTime(profile.verifiedAt)
    }
  )
}

/** Why Verify cannot run now, in the order main's verifier refuses; null when it can. No budget gate. */
function verifyBlock(status: WorkbenchRoutingStatusView | null): string | null {
  if (status === null) {
    return translate(
      'auto.components.settings.clef.verification.blockStatus',
      'The verification status could not be read.'
    )
  }
  const { credentials } = status
  if (
    credentials.protection !== 'sealed' ||
    !credentials.tokenPresent ||
    !credentials.accountPresent
  ) {
    return translate(
      'auto.components.settings.clef.verification.blockCredentials',
      'Verify needs saved, sealed credentials.'
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

/** Set when the stored profile names another question bundle than the one this build sends. */
function otherBundleNote(status: WorkbenchRoutingStatusView): string | undefined {
  const verifiedAgainst = status.profile.verifiedAgainstBundleSha256
  if (verifiedAgainst === null || verifiedAgainst === status.bundle.sha256) {
    return undefined
  }
  return translate(
    'auto.components.settings.clef.verification.otherBundle',
    'Profile verified against a different bundle ({{profile}}); this build sends {{bundle}}. Run Verify to pin a profile for this bundle.',
    { profile: verifiedAgainst.slice(0, 12), bundle: status.bundle.sha256.slice(0, 12) }
  )
}

function Fact(props: {
  icon: React.ReactNode
  term: string
  value: string
  note?: string
}): React.JSX.Element {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{props.icon}</span>
      <span className="min-w-0">
        <span className="text-muted-foreground">{props.term}</span>{' '}
        <span className="text-foreground">{props.value}</span>
        {props.note ? <span className="block text-muted-foreground">{props.note}</span> : null}
      </span>
    </li>
  )
}

function StatusFacts({ status }: { status: WorkbenchRoutingStatusView }): React.JSX.Element {
  const routing = clefRoutingStatusMessage(status.status)
  const icon = 'size-3.5'
  return (
    <ul
      aria-label={translate(
        'auto.components.settings.clef.verification.factsLabel',
        'Verification status'
      )}
      className="space-y-1.5 text-xs"
    >
      <Fact
        icon={
          status.profile.present ? (
            <ShieldCheck className={icon} />
          ) : (
            <ShieldQuestion className={icon} />
          )
        }
        term={translate(
          'auto.components.settings.clef.verification.profileTerm',
          'Response profile:'
        )}
        value={profileText(status)}
        note={otherBundleNote(status)}
      />
      <Fact
        icon={<FileCheck2 className={icon} />}
        term={translate('auto.components.settings.clef.verification.statusTerm', 'Clef status:')}
        value={routing.label}
        note={routing.detail}
      />
      <Fact
        icon={<Layers className={icon} />}
        term={translate(
          'auto.components.settings.clef.verification.bundleTerm',
          'Question bundle:'
        )}
        value={translate(
          'auto.components.settings.clef.verification.bundle',
          'Question set {{set}}, taxonomy {{taxonomy}}',
          { set: status.bundle.questionSetVersion, taxonomy: status.bundle.taxonomyVersion }
        )}
      />
    </ul>
  )
}

/** Verify the Clef answer format with one call, read the v2 report and pin it (D-016, D-020, D-022). */
export function ClefVerificationSection(): React.JSX.Element {
  const headingId = useId()
  const model = useClefVerification()
  const block = model.loading ? null : verifyBlock(model.status)

  return (
    <section
      aria-labelledby={headingId}
      data-clef-slot="verification-profile"
      className="space-y-3 border-t border-border/60 pt-3"
    >
      <div className="space-y-0.5">
        <h4 id={headingId} className="text-sm font-medium text-foreground">
          {translate(
            'auto.components.settings.clef.verification.title',
            'Verification and response profile'
          )}
        </h4>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.clef.verification.intro',
            "Verify sends one synthetic task to check Clef's answer format. Pinning its report lets Clef classify tasks; the Routing Table then picks the executor."
          )}
        </p>
      </div>
      {model.statusError === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {model.statusError}
        </p>
      )}
      {model.status === null ? null : <StatusFacts status={model.status} />}
      {model.status === null ? null : <ClefAwaitingConfirmation bundle={model.status.bundle} />}
      <div className="flex flex-wrap items-center gap-2">
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
        {block === null ? null : <span className="text-xs text-muted-foreground">{block}</span>}
      </div>
      {model.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {model.error}
        </p>
      )}
      <div role="status" aria-live="polite" className="text-xs text-muted-foreground empty:hidden">
        {model.pinned
          ? translate(
              'auto.components.settings.clef.verification.pinned',
              'Profile pinned. Clef status: {{status}}. Profile {{hash}}.',
              {
                status: clefRoutingStatusMessage(model.pinned.routingStatus).label,
                hash: model.pinned.profileHash.slice(0, 12)
              }
            )
          : ''}
      </div>
      {model.result === null ? null : (
        <ClefVerificationResult
          result={model.result}
          pinning={model.running === 'pin'}
          onPin={(reportSha256) => void model.pin(reportSha256)}
        />
      )}
    </section>
  )
}

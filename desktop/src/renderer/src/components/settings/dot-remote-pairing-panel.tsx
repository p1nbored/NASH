import { useId, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { DOT_REMOTE_OWNER_PAGES } from '../../../../shared/dot-remote/dot-remote-owner-pages'
import type {
  WorkbenchDotRemotePairingView,
  WorkbenchDotRemoteStatusView
} from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { usePromptCacheCountdownNow } from '../sidebar/prompt-cache-countdown-clock'
import { Button } from '../ui/button'
import { DotRemoteRefusalLine } from './dot-remote-refusal-line'
import { DotRemoteRevokeDialog, dotRemoteRevokeLabel } from './dot-remote-revoke-dialog'
import { dotRemotePairedLine, dotRemotePairingEndMessage } from './dot-remote-status-messages'
import type { DotRemoteModel } from './use-dot-remote-access'
import { useDotRemotePairingFocus } from './use-dot-remote-pairing-focus'

type Status = WorkbenchDotRemoteStatusView

function formatSecondsLeft(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function startBlocker(status: Status): string | null {
  if (!status.enabled) {
    return translate(
      'auto.components.settings.dotRemote.pairing.needsSwitch',
      'Turn on remote access to pair.'
    )
  }
  if (status.origin === null || status.serviceToken !== 'sealed') {
    return translate(
      'auto.components.settings.dotRemote.pairing.needsConnectionPlain',
      'Save the Site address and access token to pair.'
    )
  }
  return null
}

function startLabel(status: Status, pairing: WorkbenchDotRemotePairingView | null): string {
  if (status.state === 'pair_again') {
    return translate('auto.components.settings.dotRemote.pairing.pairAgain', 'Pair again')
  }
  const ended =
    pairing?.state === 'expired' || pairing?.state === 'denied' || pairing?.state === 'failed'
  return ended
    ? translate('auto.components.settings.dotRemote.pairing.startAgain', 'Start pairing again')
    : translate('auto.components.settings.dotRemote.pairing.start', 'Start pairing')
}

/** The code the owner approves on the Site, in large text, with the page and a countdown. */
function PairingCode({
  ref,
  userCode,
  expiresAt,
  origin
}: {
  ref: React.Ref<HTMLDivElement>
  userCode: string
  expiresAt: string
  origin: string
}): React.JSX.Element {
  const labelId = useId()
  const now = usePromptCacheCountdownNow(true)
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))
  // Why the contract's path: the Site serves the approval page there (the endpoint table names it).
  const pageUrl = `${origin}${DOT_REMOTE_OWNER_PAGES.pairingApproval}`
  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={labelId}
      // Why focusable: Start pairing gives way to the code, so focus lands here to read it next.
      tabIndex={-1}
      className="space-y-row rounded-lg bg-muted p-group outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p id={labelId} className="text-meta text-muted-foreground">
        {translate('auto.components.settings.dotRemote.pairing.codeLabel', 'Pairing code')}
      </p>
      <p className="select-text font-mono text-display font-semibold tracking-widest text-foreground">
        {userCode}
      </p>
      <p className="text-meta text-muted-foreground">
        {translate(
          'auto.components.settings.dotRemote.pairing.instructions',
          'Open the pairing page on your Site while signed in as its owner, check that it shows this code, and approve it.'
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 select-text break-all font-mono text-meta text-foreground">
          {pageUrl}
        </code>
        <Button variant="outline" size="xs" onClick={() => void window.api.shell.openUrl(pageUrl)}>
          <ExternalLink aria-hidden="true" />
          {translate('auto.components.settings.dotRemote.pairing.openPage', 'Open pairing page')}
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">
        {secondsLeft > 0
          ? translate(
              'auto.components.settings.dotRemote.pairing.expiresIn',
              'Expires in {{time}}',
              {
                time: formatSecondsLeft(secondsLeft)
              }
            )
          : translate(
              'auto.components.settings.dotRemote.pairing.codeExpired',
              'The code has expired. Checking with the Site.'
            )}
      </p>
    </div>
  )
}

/** RG4 device pairing: the owner approves this computer's code on the Site; revoking fences it. */
export function DotRemotePairingPanel({
  model,
  status
}: {
  model: DotRemoteModel
  status: Status
}): React.JSX.Element {
  const headingId = useId()
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const view = model.pairing
  // Why the status check: the code is only worth showing while the app itself reports pairing.
  const waiting = view?.state === 'waiting_for_approval' && status.state === 'pairing' ? view : null
  const ended = view === null ? null : dotRemotePairingEndMessage(view.state)
  const blocker = startBlocker(status)
  // Why not on a token stop: pasting a current token resumes it; only pair_again needs a new pairing.
  const showStart = waiting === null && (status.pairing === null || status.state === 'pair_again')
  const pairedLine = dotRemotePairedLine(status.pairing)
  const busy = model.busy !== null
  const focus = useDotRemotePairingFocus(busy)
  return (
    <section ref={focus.sectionRef} aria-labelledby={headingId} className="space-y-row">
      <h4
        ref={focus.headingRef}
        id={headingId}
        tabIndex={-1}
        className="rounded-sm text-body font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {translate('auto.components.settings.dotRemote.pairing.title', 'Pairing')}
      </h4>
      {waiting !== null &&
      waiting.userCode !== null &&
      waiting.expiresAt !== null &&
      status.origin !== null ? (
        <PairingCode
          ref={focus.codeRef}
          userCode={waiting.userCode}
          expiresAt={waiting.expiresAt}
          origin={status.origin}
        />
      ) : null}
      {pairedLine === null ? null : <p className="text-meta text-muted-foreground">{pairedLine}</p>}
      {/* Why always mounted: screen readers announce text added to a live region, not a new one. */}
      <div aria-live="polite" className="space-y-1 text-meta text-foreground empty:hidden">
        {ended === null ? null : <p>{ended}</p>}
        {model.siteNotTold ? (
          <p>
            {translate(
              'auto.components.settings.dotRemote.revoke.siteNotTold',
              'Revoked on this computer. The Site could not be told, so it may still list this pairing.'
            )}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showStart ? (
          <Button
            ref={focus.startRef}
            size="sm"
            disabled={blocker !== null || busy}
            onClick={() => {
              focus.request('after-start')
              void model.startPairing()
            }}
          >
            {model.busy === 'pairing' ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            {startLabel(status, view)}
          </Button>
        ) : null}
        {status.pairing === null ? null : (
          <Button
            ref={focus.revokeRef}
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setConfirmingRevoke(true)}
          >
            {model.busy === 'revoke' ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            {dotRemoteRevokeLabel()}
          </Button>
        )}
        {showStart && blocker !== null ? (
          <span className="text-meta text-muted-foreground">{blocker}</span>
        ) : null}
      </div>
      <DotRemoteRefusalLine model={model} scope="pairing" />
      <DotRemoteRefusalLine model={model} scope="revoke" />
      <DotRemoteRevokeDialog
        open={confirmingRevoke && status.pairing !== null}
        onOpenChange={(open) => {
          if (!open) {
            focus.request('revoke-button')
          }
          setConfirmingRevoke(open)
        }}
        onConfirm={() => {
          focus.request('after-revoke')
          setConfirmingRevoke(false)
          void model.revoke()
        }}
        contentRef={focus.dialogRef}
        onCloseAutoFocus={focus.onDialogCloseAutoFocus}
      />
    </section>
  )
}

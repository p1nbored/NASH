import { useEffect, useId, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { WorkbenchDotRemoteStatusView } from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { checkDotRemoteOrigin } from './dot-remote-origin-check'
import { moveFocusIfUnclaimed } from './dot-remote-focus'
import { DotRemoteRefusalLine } from './dot-remote-refusal-line'
import {
  dotRemoteMissingTokenMessage,
  dotRemoteOriginProblemMessage
} from './dot-remote-refusal-messages'
import { dotRemoteTokenProtectionMessage } from './dot-remote-status-messages'
import { RoutingWarningCallout } from './routing-warning-callout'
import type { DotRemoteModel } from './use-dot-remote-access'

type Problem = { field: 'origin' | 'token'; message: string }

function TokenProtection({
  status
}: {
  status: WorkbenchDotRemoteStatusView
}): React.JSX.Element | null {
  const message = dotRemoteTokenProtectionMessage(status.serviceToken)
  if (message === null) {
    return null
  }
  if (status.serviceToken === 'sealed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Check aria-hidden="true" className="size-3.5" />
        {message}
      </span>
    )
  }
  return (
    <RoutingWarningCallout
      label={translate('auto.components.settings.dotRemote.token.notUsable', 'Token not usable')}
    >
      <p>{message}</p>
    </RoutingWarningCallout>
  )
}

/**
 * The Site origin and its service access token. The token field is uncontrolled: its value is read
 * once on Save, cleared before the call, and never held in React state or shown again.
 */
export function DotRemoteConnectionForm({
  model,
  status
}: {
  model: DotRemoteModel
  status: WorkbenchDotRemoteStatusView
}): React.JSX.Element {
  const baseId = useId()
  const headingId = `${baseId}-heading`
  const originId = `${baseId}-origin`
  const tokenId = `${baseId}-token`
  const problemId = `${baseId}-problem`
  const sectionRef = useRef<HTMLElement>(null)
  const originRef = useRef<HTMLInputElement>(null)
  const tokenRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [origin, setOrigin] = useState(status.origin ?? '')
  const [shownOrigin, setShownOrigin] = useState(status.origin)
  const [problem, setProblem] = useState<Problem | null>(null)
  const busy = model.busy !== null
  const tokenSaved = status.serviceToken === 'sealed'
  const describedBy = (field: Problem['field'], helpId: string): string =>
    problem?.field === field ? `${helpId} ${problemId}` : helpId

  // Why in place, not a remount: a newly saved origin refills the field without dropping focus.
  if (shownOrigin !== status.origin) {
    setShownOrigin(status.origin)
    setOrigin(status.origin ?? '')
    setProblem(null)
  }

  useEffect(() => {
    // Why: a token typed for the previous origin must not be sent to a new one.
    if (tokenRef.current !== null) {
      tokenRef.current.value = ''
    }
  }, [status.origin])

  useEffect(() => {
    // Why: Chromium drops focus from a control disabled while saving; return it once the save settles.
    const target = restoreFocusRef.current
    if (busy || target === null) {
      return
    }
    restoreFocusRef.current = null
    moveFocusIfUnclaimed([target, submitRef.current], [sectionRef.current])
  }, [busy])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (busy) {
      return
    }
    const checked = checkDotRemoteOrigin(origin)
    if (!checked.ok) {
      setProblem({ field: 'origin', message: dotRemoteOriginProblemMessage(checked.reason) })
      originRef.current?.focus()
      return
    }
    const field = tokenRef.current
    const serviceToken = field?.value ?? ''
    if (serviceToken.trim() === '') {
      setProblem({ field: 'token', message: dotRemoteMissingTokenMessage() })
      field?.focus()
      return
    }
    // Why before the call resolves: the token leaves the field as soon as it is sent.
    if (field !== null) {
      field.value = ''
    }
    setProblem(null)
    const active = document.activeElement
    restoreFocusRef.current =
      active instanceof HTMLElement && sectionRef.current?.contains(active) === true ? active : null
    void model.saveConnection({ origin: checked.origin, serviceToken }).then((saved) => {
      if (saved) {
        toast.success(
          translate('auto.components.settings.dotRemote.connection.saved', 'Connection saved.')
        )
      }
    })
  }

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className="space-y-3 border-t border-border/60 pt-3"
    >
      <div className="space-y-0.5">
        <h4 id={headingId} className="text-sm font-medium text-foreground">
          {translate('auto.components.settings.dotRemote.connection.title', 'Connection')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.dotRemote.connection.description',
            'Saving needs both values. Changing the origin ends the current pairing.'
          )}
        </p>
      </div>
      <form noValidate autoComplete="off" onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={originId}>
            {translate('auto.components.settings.dotRemote.connection.originLabel', 'Site origin')}
          </Label>
          <Input
            ref={originRef}
            id={originId}
            type="url"
            inputMode="url"
            value={origin}
            onChange={(event) => {
              setOrigin(event.target.value)
              setProblem((shown) => (shown?.field === 'origin' ? null : shown))
            }}
            placeholder={translate(
              'auto.components.settings.dotRemote.connection.originPlaceholder',
              'https://example.com'
            )}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={problem?.field === 'origin' || undefined}
            aria-describedby={describedBy('origin', `${originId}-help`)}
          />
          <p id={`${originId}-help`} className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.dotRemote.connection.originHelp',
              'The https address of your GPT Site, with nothing after the host name.'
            )}
          </p>
        </div>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={tokenId}>
              {translate(
                'auto.components.settings.dotRemote.connection.tokenLabel',
                'Site access token'
              )}
            </Label>
            {tokenSaved ? <TokenProtection status={status} /> : null}
          </div>
          <Input
            ref={tokenRef}
            id={tokenId}
            type="password"
            defaultValue=""
            onChange={() => setProblem((shown) => (shown?.field === 'token' ? null : shown))}
            placeholder={
              tokenSaved
                ? translate(
                    'auto.components.settings.dotRemote.connection.tokenReplace',
                    'Paste a new token to replace the saved one'
                  )
                : undefined
            }
            disabled={busy}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={problem?.field === 'token' || undefined}
            aria-describedby={describedBy('token', `${tokenId}-help`)}
          />
          <p id={`${tokenId}-help`} className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.dotRemote.connection.tokenHelp',
              "Copy it from your Site's settings, under service access. The app seals it on this computer and never shows it again."
            )}
          </p>
          {tokenSaved ? null : <TokenProtection status={status} />}
        </div>
        {problem === null ? null : (
          <p id={problemId} role="alert" className="text-xs text-destructive">
            {problem.message}
          </p>
        )}
        <DotRemoteRefusalLine model={model} scope="connection" />
        <Button ref={submitRef} type="submit" variant="outline" size="sm" disabled={busy}>
          {model.busy === 'connection' ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : null}
          {translate('auto.components.settings.dotRemote.connection.save', 'Save connection')}
        </Button>
      </form>
    </section>
  )
}

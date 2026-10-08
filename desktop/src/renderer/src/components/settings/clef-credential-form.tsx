import { useId, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import type { ClefCredentialSaveInput } from '../../../../shared/clef/clef-credential-contract'
import { clefMissingFieldsMessage } from './clef-credential-messages'

type SecretFieldProps = {
  id: string
  label: string
  toggleLabel: string
  description: string
  value: string
  visible: boolean
  invalid: boolean
  disabled: boolean
  onChange: (value: string) => void
  onToggleVisible: () => void
}

function ClefSecretField(props: SecretFieldProps): React.JSX.Element {
  const descriptionId = `${props.id}-description`
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <div className="flex gap-2">
        <Input
          id={props.id}
          type={props.visible ? 'text' : 'password'}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          disabled={props.disabled}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={props.invalid || undefined}
          aria-describedby={descriptionId}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          aria-label={props.toggleLabel}
          aria-pressed={props.visible}
          aria-controls={props.id}
          disabled={props.disabled}
          onClick={props.onToggleVisible}
          className="shrink-0"
        >
          {props.visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {translate('auto.components.settings.clef.form.show', 'Show')}
        </Button>
      </div>
      <p id={descriptionId} className="text-meta text-muted-foreground">
        {props.description}
      </p>
    </div>
  )
}

/**
 * Token and account entry. Values live only in this form's state until Save, then are cleared
 * whatever the outcome; main never sends them back.
 */
export function ClefCredentialForm({
  busy,
  onSave,
  onCancel,
  extraAction
}: {
  busy: boolean
  onSave: (input: ClefCredentialSaveInput) => Promise<void>
  /** Shown while replacing saved credentials, to keep them as they are. */
  onCancel?: () => void
  /** A secondary action beside Save, such as clearing what is stored. */
  extraAction?: React.ReactNode
}): React.JSX.Element {
  const baseId = useId()
  const tokenId = `${baseId}-clef-token`
  const accountId = `${baseId}-clef-account`
  const [token, setToken] = useState('')
  const [account, setAccount] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [accountVisible, setAccountVisible] = useState(false)
  const [missingFields, setMissingFields] = useState(false)

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (busy) {
      return
    }
    if (token.trim() === '' || account.trim() === '') {
      setMissingFields(true)
      return
    }
    const input = { token, accountId: account }
    // Why before the call resolves: the values leave the DOM as soon as they are sent.
    setToken('')
    setAccount('')
    setTokenVisible(false)
    setAccountVisible(false)
    setMissingFields(false)
    void onSave(input)
  }

  return (
    <form
      noValidate
      autoComplete="off"
      onSubmit={handleSubmit}
      aria-label={translate('auto.components.settings.clef.form.label', 'Clef credentials')}
      className="space-y-group"
    >
      <ClefSecretField
        id={tokenId}
        label={translate('auto.components.settings.clef.form.tokenLabel', 'API token')}
        toggleLabel={translate('auto.components.settings.clef.form.showToken', 'Show API token')}
        description={translate(
          'auto.components.settings.clef.form.tokenDescriptionPlain',
          'From your Cloudflare dashboard, with access to Workers AI.'
        )}
        value={token}
        visible={tokenVisible}
        invalid={missingFields && token.trim() === ''}
        disabled={busy}
        onChange={setToken}
        onToggleVisible={() => setTokenVisible((visible) => !visible)}
      />
      <ClefSecretField
        id={accountId}
        label={translate('auto.components.settings.clef.form.accountLabel', 'Account ID')}
        toggleLabel={translate('auto.components.settings.clef.form.showAccount', 'Show account ID')}
        description={translate(
          'auto.components.settings.clef.form.accountDescriptionPlain',
          'Your 32-character Cloudflare account ID.'
        )}
        value={account}
        visible={accountVisible}
        invalid={missingFields && account.trim() === ''}
        disabled={busy}
        onChange={setAccount}
        onToggleVisible={() => setAccountVisible((visible) => !visible)}
      />
      {missingFields ? (
        <p role="alert" className="text-meta text-destructive">
          {clefMissingFieldsMessage()}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-row">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {translate('auto.components.settings.clef.form.save', 'Save credentials')}
        </Button>
        {onCancel === undefined ? null : (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            {translate('auto.components.settings.clef.form.cancel', 'Cancel')}
          </Button>
        )}
        {extraAction}
      </div>
    </form>
  )
}

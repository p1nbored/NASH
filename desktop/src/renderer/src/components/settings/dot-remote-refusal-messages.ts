import { ZodError } from 'zod'
import { translate } from '@/i18n/i18n'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { DOT_REMOTE_RPC_ERROR_CODES } from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import type { DotRemoteOriginProblem } from './dot-remote-origin-check'

// Plain English for every refusal of the remote access methods. The server's text, the pasted
// values and any header are never shown: only the code (and a token shape reason) choose the text.

const CODES = DOT_REMOTE_RPC_ERROR_CODES

export function dotRemoteOriginProblemMessage(reason: DotRemoteOriginProblem): string {
  switch (reason) {
    case 'empty':
      return translate(
        'auto.components.settings.dotRemote.refusals.originEmptyPlain',
        'Enter the Site address, such as https://example.com.'
      )
    case 'too_long':
      return translate(
        'auto.components.settings.dotRemote.refusals.originTooLongPlain',
        'The Site address is too long.'
      )
    case 'spaces':
      return translate(
        'auto.components.settings.dotRemote.refusals.originSpacesPlain',
        'The Site address cannot contain spaces.'
      )
    case 'not_a_url':
      return translate(
        'auto.components.settings.dotRemote.refusals.originNotUrl',
        'Enter a full web address, such as https://example.com.'
      )
    case 'not_https':
      return translate(
        'auto.components.settings.dotRemote.refusals.originNotHttpsPlain',
        'The Site address must start with https://.'
      )
    case 'sign_in_details':
      return translate(
        'auto.components.settings.dotRemote.refusals.originSignInPlain',
        'Remove the sign-in details from the Site address; the access token goes in its own field.'
      )
    case 'path':
      return translate(
        'auto.components.settings.dotRemote.refusals.originPathPlain',
        'Enter only the Site address, with nothing after the host name, such as https://example.com.'
      )
  }
}

export function dotRemoteMissingTokenMessage(): string {
  return translate(
    'auto.components.settings.dotRemote.refusals.tokenEmpty',
    'Paste the Site access token.'
  )
}

/** The main process names only which rule the pasted token broke, never the token itself. */
function tokenRefusalMessage(data: unknown): string {
  const reason =
    typeof data === 'object' && data !== null
      ? Object.entries(data).find(([key]) => key === 'reason')?.[1]
      : null
  switch (reason) {
    case 'token_missing':
      return translate(
        'auto.components.settings.dotRemote.refusals.tokenMissing',
        'The Site access token was empty. Paste it again.'
      )
    case 'token_too_short':
      return translate(
        'auto.components.settings.dotRemote.refusals.tokenTooShort',
        'The Site access token is too short. Copy the whole token and paste it again.'
      )
    case 'token_too_long':
      return translate(
        'auto.components.settings.dotRemote.refusals.tokenTooLong',
        'The Site access token is too long.'
      )
    case 'token_invalid_characters':
      return translate(
        'auto.components.settings.dotRemote.refusals.tokenCharacters',
        'The Site access token contains spaces or characters a token cannot have. Paste it again.'
      )
    default:
      return translate(
        'auto.components.settings.dotRemote.refusals.tokenInvalid',
        'The Site access token is not in the expected form. Paste it again.'
      )
  }
}

function remoteCodeMessage(code: string, data: unknown): string | null {
  switch (code) {
    case CODES.unavailable:
      return translate(
        'auto.components.settings.dotRemote.refusals.unavailable',
        'Remote access is not running in this session. Restart the app and check again.'
      )
    case CODES.disabled:
      return translate(
        'auto.components.settings.dotRemote.refusals.disabled',
        'Turn on remote access first.'
      )
    case CODES.notConfigured:
      return translate(
        'auto.components.settings.dotRemote.refusals.notConfiguredPlain',
        'Save the Site address and its access token first.'
      )
    case CODES.originInvalid:
      return translate(
        'auto.components.settings.dotRemote.refusals.originInvalidPlain',
        'The app refused the Site address. Use an https address such as https://example.com, with nothing after the host name.'
      )
    case CODES.tokenInvalid:
      return tokenRefusalMessage(data)
    case CODES.sealingUnavailable:
      return translate(
        'auto.components.settings.dotRemote.refusals.sealingUnavailablePlain',
        'This computer cannot store the token safely, so nothing was stored.'
      )
    case CODES.credentialWriteFailed:
      return translate(
        'auto.components.settings.dotRemote.refusals.writeFailed',
        'The token could not be stored, so nothing was stored.'
      )
    case CODES.siteUnreachable:
      return translate(
        'auto.components.settings.dotRemote.refusals.siteUnreachablePlain',
        'The Site could not be reached. Check the address and your connection, then try again.'
      )
    case CODES.reconnectNeeded:
      return translate(
        'auto.components.settings.dotRemote.refusals.reconnectNeeded',
        "The Site refused this computer's access. Paste a new Site access token, then start pairing again."
      )
    case CODES.pairingRefused:
      return translate(
        'auto.components.settings.dotRemote.refusals.pairingRefused',
        'The Site refused to start pairing. Try again in a few minutes.'
      )
    default:
      return null
  }
}

function sharedCodeMessage(code: string | null): string {
  switch (code) {
    case 'method_not_found':
      return translate(
        'auto.components.settings.dotRemote.refusals.notConnected',
        'Remote access is not connected in this build yet, so it cannot be shown or changed.'
      )
    case 'workbench_forbidden':
      return translate(
        'auto.components.settings.dotRemote.refusals.forbidden',
        'Only the desktop app on this computer can read or change remote access.'
      )
    case 'invalid_argument':
      return translate(
        'auto.components.settings.dotRemote.refusals.invalidValue',
        'The app refused this value, so nothing was changed.'
      )
    case null:
    default:
      return translate(
        'auto.components.settings.dotRemote.refusals.callFailed',
        'The remote access request did not complete. The current state is shown.'
      )
  }
}

/** For a call that did not return a view; never repeats the error's own text. */
export function dotRemoteCallErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return translate(
      'auto.components.settings.dotRemote.refusals.invalidResponse',
      'The app returned a remote access state this screen cannot read.'
    )
  }
  if (!(error instanceof RuntimeRpcCallError)) {
    return sharedCodeMessage(null)
  }
  return remoteCodeMessage(error.code, error.response.error.data) ?? sharedCodeMessage(error.code)
}

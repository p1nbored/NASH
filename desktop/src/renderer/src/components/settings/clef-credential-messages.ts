import { translate } from '@/i18n/i18n'
import type {
  ClefCredentialClearRefusal,
  ClefCredentialSaveRefusal
} from '../../../../shared/clef/clef-credential-contract'

/** Plain-English outcome for each refusal code main can return; never echoes what was typed. */
export function clefRefusalMessage(
  code: ClefCredentialSaveRefusal | ClefCredentialClearRefusal
): string {
  switch (code) {
    case 'token_missing':
      return translate(
        'auto.components.settings.clef.credentials.tokenMissing',
        'Enter the API token.'
      )
    case 'token_too_short':
      return translate(
        'auto.components.settings.clef.credentials.tokenTooShort',
        'The API token is too short, so nothing was saved. Paste the whole token.'
      )
    case 'token_too_long':
      return translate(
        'auto.components.settings.clef.credentials.tokenTooLong',
        'The API token is too long, so nothing was saved. Paste only the token.'
      )
    case 'token_invalid_characters':
      return translate(
        'auto.components.settings.clef.credentials.tokenInvalidCharacters',
        'The API token can contain only visible ASCII characters with no spaces, so nothing was saved.'
      )
    case 'account_id_missing':
      return translate(
        'auto.components.settings.clef.credentials.accountIdMissing',
        'Enter the account ID.'
      )
    case 'account_id_invalid_format':
      return translate(
        'auto.components.settings.clef.credentials.accountIdInvalid',
        'The account ID must be 32 lowercase hexadecimal characters, so nothing was saved.'
      )
    case 'sealing_unavailable':
      return translate(
        'auto.components.settings.clef.credentials.sealingUnavailablePlain',
        'This computer cannot store the token safely, so it was not saved.'
      )
    case 'write_failed':
      return translate(
        'auto.components.settings.clef.credentials.writeFailed',
        'The credentials could not be written to disk, so nothing was saved.'
      )
    case 'clear_failed':
      return translate(
        'auto.components.settings.clef.credentials.clearFailed',
        'Some stored credentials could not be removed. Try clearing them again.'
      )
  }
}

export function clefSaveCallFailedMessage(): string {
  return translate(
    'auto.components.settings.clef.credentials.saveCallFailed',
    'The credentials could not be saved because NASH did not get an answer. Enter them again to retry.'
  )
}

export function clefClearCallFailedMessage(): string {
  return translate(
    'auto.components.settings.clef.credentials.clearCallFailed',
    'NASH could not confirm that the credentials were cleared. Check the status above and try again.'
  )
}

export function clefMissingFieldsMessage(): string {
  return translate(
    'auto.components.settings.clef.credentials.missingFields',
    'Enter both the API token and the account ID.'
  )
}

export function clefSavedMessage(): string {
  return translate(
    'auto.components.settings.clef.credentials.savedPlain',
    'Saved. The token will never be shown again.'
  )
}

export function clefClearedMessage(): string {
  return translate(
    'auto.components.settings.clef.credentials.cleared',
    'The API token and account ID were removed from this computer.'
  )
}

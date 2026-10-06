import { describe, expect, it } from 'vitest'
import {
  CLEF_CREDENTIAL_CHANNELS,
  CLEF_CREDENTIAL_REFUSAL_CODES,
  parseClefCredentialStatus,
  parseClefCredentialsMutationResult
} from './clef-credential-contract'

const SEALED = { tokenPresent: true, accountPresent: true, protection: 'sealed' } as const

describe('clef credential contract', () => {
  it('names the three IPC channels the main handlers register', () => {
    expect(CLEF_CREDENTIAL_CHANNELS).toEqual({
      status: 'clef:credentials:status',
      save: 'clef:credentials:save',
      clear: 'clef:credentials:clear'
    })
  })

  it('accepts a presence-and-protection status', () => {
    expect(parseClefCredentialStatus(SEALED)).toEqual(SEALED)
    expect(
      parseClefCredentialStatus({
        tokenPresent: false,
        accountPresent: false,
        protection: 'sealing_unavailable'
      })
    ).toEqual({ tokenPresent: false, accountPresent: false, protection: 'sealing_unavailable' })
  })

  it('rejects a status that is missing, malformed or carries extra fields', () => {
    expect(parseClefCredentialStatus(undefined)).toBeNull()
    expect(parseClefCredentialStatus([])).toBeNull()
    expect(parseClefCredentialStatus({ ...SEALED, protection: 'encrypted' })).toBeNull()
    expect(parseClefCredentialStatus({ ...SEALED, tokenPresent: 'yes' })).toBeNull()
    // Why: a field the contract does not name could carry a value, so it is refused outright.
    expect(parseClefCredentialStatus({ ...SEALED, token: 'FIXTURE_ONLY' })).toBeNull()
  })

  it('accepts success and every refusal code in a mutation result', () => {
    expect(parseClefCredentialsMutationResult({ ok: true, status: SEALED })).toEqual({
      ok: true,
      status: SEALED
    })
    for (const code of CLEF_CREDENTIAL_REFUSAL_CODES) {
      expect(parseClefCredentialsMutationResult({ ok: false, code, status: SEALED })).toEqual({
        ok: false,
        code,
        status: SEALED
      })
    }
  })

  it('lists exactly the shape, sealing, write and clear refusals', () => {
    expect([...CLEF_CREDENTIAL_REFUSAL_CODES].sort()).toEqual(
      [
        'account_id_invalid_format',
        'account_id_missing',
        'clear_failed',
        'sealing_unavailable',
        'token_invalid_characters',
        'token_missing',
        'token_too_long',
        'token_too_short',
        'write_failed'
      ].sort()
    )
  })

  it('rejects mutation results with unknown codes, missing status or extra fields', () => {
    expect(parseClefCredentialsMutationResult(undefined)).toBeNull()
    expect(parseClefCredentialsMutationResult({ ok: true })).toBeNull()
    expect(
      parseClefCredentialsMutationResult({ ok: false, code: 'unknown_code', status: SEALED })
    ).toBeNull()
    expect(
      parseClefCredentialsMutationResult({ ok: true, status: SEALED, accountId: 'FIXTURE_ONLY' })
    ).toBeNull()
  })
})

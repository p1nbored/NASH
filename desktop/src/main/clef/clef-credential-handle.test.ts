import { format, inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  CLEF_REDACTED_CREDENTIAL,
  ClefCredentialHandle,
  ClefCredentialShapeError,
  validateClefAccountIdShape,
  validateClefApiTokenShape,
  validateClefCredentialShapes
} from './clef-credential-handle'

// FIXTURE_ONLY: fake values shaped like real Clef credentials so redaction covers real shapes.
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'

function fixtureHandle(): ClefCredentialHandle {
  return new ClefCredentialHandle(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)
}

function expectNoCredentialText(text: string): void {
  expect(text).not.toContain(FIXTURE_ONLY_TOKEN)
  expect(text).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
}

function captureShapeError(run: () => unknown): ClefCredentialShapeError {
  try {
    run()
  } catch (error) {
    if (error instanceof ClefCredentialShapeError) {
      return error
    }
    throw error
  }
  throw new Error('expected a ClefCredentialShapeError')
}

describe('ClefCredentialHandle', () => {
  it('exposes only the bearer header and the account path segment', () => {
    const handle = fixtureHandle()
    expect(handle.authorizationHeader()).toBe(`Bearer ${FIXTURE_ONLY_TOKEN}`)
    expect(handle.accountPath()).toBe(`accounts/${FIXTURE_ONLY_ACCOUNT_ID}`)
  })

  it('redacts through String coercion and implicit joins', () => {
    const handle = fixtureHandle()
    expect(CLEF_REDACTED_CREDENTIAL).toBe('[redacted clef credential]')
    // Why: String() takes the same ToPrimitive(string) path a template literal does.
    expect(String(handle)).toBe(CLEF_REDACTED_CREDENTIAL)
    expect(handle.toString()).toBe(CLEF_REDACTED_CREDENTIAL)
    expect(['prefix', handle].join(' ')).toBe(`prefix ${CLEF_REDACTED_CREDENTIAL}`)
  })

  it('redacts through JSON serialization, including when nested', () => {
    const handle = fixtureHandle()
    expect(handle.toJSON()).toBe(CLEF_REDACTED_CREDENTIAL)
    expect(JSON.stringify(handle)).toBe(JSON.stringify(CLEF_REDACTED_CREDENTIAL))
    expect(JSON.parse(JSON.stringify({ credential: handle, list: [handle] }))).toEqual({
      credential: CLEF_REDACTED_CREDENTIAL,
      list: [CLEF_REDACTED_CREDENTIAL]
    })
  })

  it('redacts through util.inspect, format specifiers and nested error causes', () => {
    const handle = fixtureHandle()
    expect(inspect(handle)).toBe(CLEF_REDACTED_CREDENTIAL)
    expect(inspect({ nested: { handle } }, { depth: 10, showHidden: true })).toContain(
      CLEF_REDACTED_CREDENTIAL
    )
    expectNoCredentialText(inspect(handle, { customInspect: false, showHidden: true }))
    expectNoCredentialText(format('%o %O %s %j', handle, handle, handle, handle))
    const error = new Error('outer', { cause: new Error('inner', { cause: handle }) })
    expectNoCredentialText(inspect(error, { depth: 10 }))
  })

  it('keeps no own or enumerable copy of the values and cannot be patched', () => {
    const handle = fixtureHandle()
    expect(Object.keys(handle)).toEqual([])
    expect(Object.getOwnPropertyNames(handle)).toEqual([])
    expect({ ...handle }).toEqual({})
    expect(Object.isFrozen(handle)).toBe(true)
    expectNoCredentialText(JSON.stringify(structuredClone(handle)))
  })

  it('rejects malformed values with a code that never echoes the input', () => {
    const badToken = 'BAD TOKEN WITH SPACES 0000000000'
    const tokenError = captureShapeError(
      () => new ClefCredentialHandle(badToken, FIXTURE_ONLY_ACCOUNT_ID)
    )
    expect(tokenError.code).toBe('token_invalid_characters')
    expect(tokenError.message).not.toContain(badToken)
    expect(inspect(tokenError)).not.toContain(badToken)
    expectNoCredentialText(inspect(tokenError))

    const badAccountId = 'FEDCBA9876543210FEDCBA9876543210'
    const accountError = captureShapeError(
      () => new ClefCredentialHandle(FIXTURE_ONLY_TOKEN, badAccountId)
    )
    expect(accountError.code).toBe('account_id_invalid_format')
    expect(inspect(accountError)).not.toContain(badAccountId)
    expectNoCredentialText(inspect(accountError))
  })
})

describe('validateClefApiTokenShape', () => {
  it('accepts 20 to 200 visible ASCII characters', () => {
    expect(validateClefApiTokenShape(FIXTURE_ONLY_TOKEN)).toBeNull()
    expect(validateClefApiTokenShape('a'.repeat(20))).toBeNull()
    expect(validateClefApiTokenShape('~'.repeat(200))).toBeNull()
    expect(validateClefApiTokenShape('!#$%&()*+,-./:;<=>?@[]^_`{|}~0123456789')).toBeNull()
  })

  it('reports length violations by code', () => {
    expect(validateClefApiTokenShape('a'.repeat(19))).toBe('token_too_short')
    expect(validateClefApiTokenShape('a'.repeat(201))).toBe('token_too_long')
  })

  it('reports a missing token for empty and non-string values', () => {
    expect(validateClefApiTokenShape('')).toBe('token_missing')
    expect(validateClefApiTokenShape(undefined)).toBe('token_missing')
    expect(validateClefApiTokenShape(null)).toBe('token_missing')
    expect(validateClefApiTokenShape(12345)).toBe('token_missing')
  })

  it('rejects whitespace, control and non-ASCII characters', () => {
    const base = 'a'.repeat(24)
    for (const intruder of [' ', '\t', '\n', '\u007f', '\u0000', 'é', '​']) {
      expect(validateClefApiTokenShape(`${base}${intruder}${base}`)).toBe(
        'token_invalid_characters'
      )
    }
  })
})

describe('validateClefAccountIdShape', () => {
  it('accepts exactly 32 lowercase hex characters', () => {
    expect(validateClefAccountIdShape(FIXTURE_ONLY_ACCOUNT_ID)).toBeNull()
  })

  it('rejects uppercase, wrong length and non-hex values', () => {
    expect(validateClefAccountIdShape(FIXTURE_ONLY_ACCOUNT_ID.toUpperCase())).toBe(
      'account_id_invalid_format'
    )
    expect(validateClefAccountIdShape(FIXTURE_ONLY_ACCOUNT_ID.slice(1))).toBe(
      'account_id_invalid_format'
    )
    expect(validateClefAccountIdShape(`${FIXTURE_ONLY_ACCOUNT_ID}0`)).toBe(
      'account_id_invalid_format'
    )
    expect(validateClefAccountIdShape(`g${FIXTURE_ONLY_ACCOUNT_ID.slice(1)}`)).toBe(
      'account_id_invalid_format'
    )
    expect(validateClefAccountIdShape(` ${FIXTURE_ONLY_ACCOUNT_ID.slice(1)}`)).toBe(
      'account_id_invalid_format'
    )
  })

  it('reports a missing account id for empty and non-string values', () => {
    expect(validateClefAccountIdShape('')).toBe('account_id_missing')
    expect(validateClefAccountIdShape(undefined)).toBe('account_id_missing')
    expect(validateClefAccountIdShape({})).toBe('account_id_missing')
  })
})

describe('validateClefCredentialShapes', () => {
  it('returns null when both values are well formed', () => {
    expect(validateClefCredentialShapes(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toBeNull()
  })

  it('reports the token code first, then the account id code', () => {
    expect(validateClefCredentialShapes('short', 'nope')).toBe('token_too_short')
    expect(validateClefCredentialShapes(FIXTURE_ONLY_TOKEN, 'nope')).toBe(
      'account_id_invalid_format'
    )
  })
})

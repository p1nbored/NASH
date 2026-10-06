import type {
  ClefAccountIdShapeCode,
  ClefApiTokenShapeCode,
  ClefCredentialShapeCode
} from '../../shared/clef/clef-credential-contract'

export type {
  ClefAccountIdShapeCode,
  ClefApiTokenShapeCode,
  ClefCredentialShapeCode
} from '../../shared/clef/clef-credential-contract'

export const CLEF_REDACTED_CREDENTIAL = '[redacted clef credential]'

const TOKEN_MIN_LENGTH = 20
const TOKEN_MAX_LENGTH = 200
const VISIBLE_ASCII = /^[\x21-\x7e]+$/
const ACCOUNT_ID_FORMAT = /^[0-9a-f]{32}$/
const INSPECT_CUSTOM: unique symbol = Symbol.for('nodejs.util.inspect.custom')

/** Returns a validation code for a malformed token, or null; never echoes the value. */
export function validateClefApiTokenShape(value: unknown): ClefApiTokenShapeCode | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'token_missing'
  }
  if (value.length < TOKEN_MIN_LENGTH) {
    return 'token_too_short'
  }
  if (value.length > TOKEN_MAX_LENGTH) {
    return 'token_too_long'
  }
  return VISIBLE_ASCII.test(value) ? null : 'token_invalid_characters'
}

/** Returns a validation code for a malformed account id, or null; never echoes the value. */
export function validateClefAccountIdShape(value: unknown): ClefAccountIdShapeCode | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'account_id_missing'
  }
  return ACCOUNT_ID_FORMAT.test(value) ? null : 'account_id_invalid_format'
}

export function validateClefCredentialShapes(
  token: unknown,
  accountId: unknown
): ClefCredentialShapeCode | null {
  return validateClefApiTokenShape(token) ?? validateClefAccountIdShape(accountId)
}

export class ClefCredentialShapeError extends Error {
  readonly code: ClefCredentialShapeCode

  constructor(code: ClefCredentialShapeCode) {
    super(`Clef credential rejected: ${code}`)
    this.name = 'ClefCredentialShapeError'
    this.code = code
  }
}

/**
 * Holds the Clef token and account id for the transport. Every serialization path
 * (String, JSON, util.inspect) yields CLEF_REDACTED_CREDENTIAL.
 */
export class ClefCredentialHandle {
  readonly #token: string
  readonly #accountId: string

  constructor(token: string, accountId: string) {
    const code = validateClefCredentialShapes(token, accountId)
    if (code !== null) {
      throw new ClefCredentialShapeError(code)
    }
    this.#token = token
    this.#accountId = accountId
    // Why: freezing stops callers from shadowing the redacting methods on this instance.
    Object.freeze(this)
  }

  authorizationHeader(): string {
    return `Bearer ${this.#token}`
  }

  /** The `accounts/<id>` path segment; callers never see the bare id. */
  accountPath(): string {
    return `accounts/${this.#accountId}`
  }

  toString(): string {
    return CLEF_REDACTED_CREDENTIAL
  }

  toJSON(): string {
    return CLEF_REDACTED_CREDENTIAL
  }

  [INSPECT_CUSTOM](): string {
    return CLEF_REDACTED_CREDENTIAL
  }
}

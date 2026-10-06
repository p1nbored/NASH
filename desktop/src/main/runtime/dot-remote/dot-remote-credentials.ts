import { DotRemoteDeviceCredentialSchema } from '../../../shared/dot-remote/dot-remote-device-credential'

// The remote credentials, as handles that never serialize their value. The Sites service token is
// pasted by the user and the pairing's device credential is issued by the Site; both are sealed under
// the NASH data folder (no plaintext fallback). The app session token lives only in memory. Each
// travels only in its own header (RG3).

export const DOT_REMOTE_REDACTED_TOKEN = '[redacted remote access token]'

export type DotRemoteTokenShapeCode =
  | 'token_missing'
  | 'token_too_short'
  | 'token_too_long'
  | 'token_invalid_characters'

export type DotRemoteTokenProtection =
  | 'absent'
  | 'sealed'
  | 'plaintext_refused'
  | 'sealing_unavailable'

export type DotRemoteCredentialSaveResult =
  | { ok: true }
  | { ok: false; code: DotRemoteTokenShapeCode | 'sealing_unavailable' | 'write_failed' }

/** The sealed store, reached through this port so the runtime never imports electron. */
export type DotRemoteCredentialSource = {
  /** Presence and protection only; never the value. */
  status(): { present: boolean; protection: DotRemoteTokenProtection }
  /** A handle when the token is present, sealed and well formed; otherwise null. */
  read(): DotRemoteServiceToken | null
  /** Validates, then seals the token, or stores nothing. */
  save(token: string): DotRemoteCredentialSaveResult
  clear(): { ok: true } | { ok: false; code: 'clear_failed' }
  /** The pairing's device credential when present, sealed and well formed; otherwise null. */
  readDevice(): DotRemoteDeviceCredential | null
  /** Seals the credential in one atomic write, replacing the previous one, or stores nothing. */
  saveDevice(credential: string): DotRemoteDeviceCredentialSaveResult
  clearDevice(): { ok: true } | { ok: false; code: 'clear_failed' }
}

export type DotRemoteDeviceCredentialSaveResult =
  | { ok: true }
  | { ok: false; code: 'credential_invalid' | 'sealing_unavailable' | 'write_failed' }

const TOKEN_MIN_CHARS = 16
const TOKEN_MAX_CHARS = 4096
const VISIBLE_ASCII = /^[\x21-\x7e]+$/
const BEARER_PREFIX = /^bearer\s+/i
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43,128}$/
const INSPECT_CUSTOM: unique symbol = Symbol.for('nodejs.util.inspect.custom')

/** A pasted value may carry spaces around it or the header's Bearer prefix. */
export function normalizeDotRemoteServiceToken(value: string): string {
  return value.trim().replace(BEARER_PREFIX, '').trim()
}

/** A code for a malformed token, or null; never echoes the value. */
export function validateDotRemoteServiceTokenShape(value: unknown): DotRemoteTokenShapeCode | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'token_missing'
  }
  if (value.length < TOKEN_MIN_CHARS) {
    return 'token_too_short'
  }
  if (value.length > TOKEN_MAX_CHARS) {
    return 'token_too_long'
  }
  return VISIBLE_ASCII.test(value) ? null : 'token_invalid_characters'
}

/** The Sites platform service token; only `OAI-Sites-Authorization` ever carries it. */
export class DotRemoteServiceToken {
  readonly #token: string

  constructor(token: string) {
    const code = validateDotRemoteServiceTokenShape(token)
    if (code !== null) {
      throw new Error(`Remote access token rejected: ${code}`)
    }
    this.#token = token
    // Why: freezing stops callers from shadowing the redacting methods on this instance.
    Object.freeze(this)
  }

  authorizationHeader(): string {
    return `Bearer ${this.#token}`
  }

  toString(): string {
    return DOT_REMOTE_REDACTED_TOKEN
  }

  toJSON(): string {
    return DOT_REMOTE_REDACTED_TOKEN
  }

  [INSPECT_CUSTOM](): string {
    return DOT_REMOTE_REDACTED_TOKEN
  }
}

/** The mailbox session the Site issued; only `Nash-Session` ever carries it. */
export class DotRemoteSessionToken {
  readonly #token: string

  constructor(token: string) {
    if (!SESSION_TOKEN.test(token)) {
      throw new Error('Remote session token rejected: malformed')
    }
    this.#token = token
    Object.freeze(this)
  }

  headerValue(): string {
    return this.#token
  }

  toString(): string {
    return DOT_REMOTE_REDACTED_TOKEN
  }

  toJSON(): string {
    return DOT_REMOTE_REDACTED_TOKEN
  }

  [INSPECT_CUSTOM](): string {
    return DOT_REMOTE_REDACTED_TOKEN
  }
}

/** The pairing's device credential; only `Nash-Device-Credential` on a refresh ever carries it. */
export class DotRemoteDeviceCredential {
  readonly #credential: string

  constructor(credential: string) {
    if (!DotRemoteDeviceCredentialSchema.safeParse(credential).success) {
      throw new Error('Remote device credential rejected: malformed')
    }
    this.#credential = credential
    Object.freeze(this)
  }

  headerValue(): string {
    return this.#credential
  }

  toString(): string {
    return DOT_REMOTE_REDACTED_TOKEN
  }

  toJSON(): string {
    return DOT_REMOTE_REDACTED_TOKEN
  }

  [INSPECT_CUSTOM](): string {
    return DOT_REMOTE_REDACTED_TOKEN
  }
}

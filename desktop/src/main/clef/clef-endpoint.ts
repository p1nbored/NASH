/** Pinned Clef endpoint (spec section 5). Only the transport ever holds the concrete URL. */
export const CLEF_API_ORIGIN = 'https://api.cloudflare.com'
export const CLEF_MODEL_PATH = '@cf/cloudflare/clef'
export const CLEF_BODY_MODEL = 'clef'
export const CLEF_ACCOUNT_PLACEHOLDER = '{account_id}'
export const CLEF_PATH_TEMPLATE = `/client/v4/accounts/${CLEF_ACCOUNT_PLACEHOLDER}/ai/run/${CLEF_MODEL_PATH}`
/** The only URL form that may be recorded, logged or shown. */
export const CLEF_URL_TEMPLATE = `${CLEF_API_ORIGIN}${CLEF_PATH_TEMPLATE}`
export const CLEF_PROXY_PROBE_URL = `${CLEF_API_ORIGIN}/`

/**
 * Structural view of the sealed credential handle; the full handle lives in
 * clef-credential-port.ts. Defined here so the transport never depends on the store.
 */
export type ClefCredentialHandleLike = {
  authorizationHeader(): string
  accountPath(): string
}

// Why several forms: the handle may hand out the bare id or its `accounts/<id>` path; all reduce to one 32-hex id.
const ACCOUNT_PATH_PATTERN = /^(?:(?:\/client\/v4)?\/?accounts\/)?([0-9a-f]{32})\/?$/

// Spec section 5: the body never carries images or options.
const FORBIDDEN_BODY_KEYS = ['images', 'options'] as const

export type ClefRunUrlResult = { ok: true; url: string; accountId: string } | { ok: false }

export function isPinnedClefModel(modelPath: unknown, bodyModel: unknown): boolean {
  return modelPath === CLEF_MODEL_PATH && bodyModel === CLEF_BODY_MODEL
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : null
  } catch {
    return null
  }
}

/** Last check before the wire: the serialized body names the pinned model and nothing forbidden. */
export function isPinnedClefRequestBody(body: Uint8Array): boolean {
  const parsed = parseJsonObject(body)
  return (
    parsed !== null &&
    !FORBIDDEN_BODY_KEYS.some((key) => Object.hasOwn(parsed, key)) &&
    isPinnedClefModel(CLEF_MODEL_PATH, parsed.model)
  )
}

function readAccountId(credentials: Pick<ClefCredentialHandleLike, 'accountPath'>): string | null {
  try {
    const match = ACCOUNT_PATH_PATTERN.exec(credentials.accountPath())
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/** Builds the concrete run URL; failure never echoes the account value. */
export function buildClefRunUrl(
  credentials: Pick<ClefCredentialHandleLike, 'accountPath'>
): ClefRunUrlResult {
  const accountId = readAccountId(credentials)
  if (accountId === null) {
    return { ok: false }
  }
  const url = `${CLEF_API_ORIGIN}${CLEF_PATH_TEMPLATE.replace(CLEF_ACCOUNT_PLACEHOLDER, accountId)}`
  return new URL(url).origin === CLEF_API_ORIGIN ? { ok: true, url, accountId } : { ok: false }
}

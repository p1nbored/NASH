/**
 * Clef-specific scrubbing for anything that leaves the transport (span attributes,
 * events, errors). Always returns new values; inputs are never mutated.
 */
export const CLEF_REDACTED = '[redacted]'

// Why a floor: an empty or one-letter "secret" would shred every diagnostic string.
const MIN_SECRET_LENGTH = 8
const MAX_VALUE_DEPTH = 8
// Keeps the `{account_id}` placeholder so recorded URL templates survive.
const ACCOUNT_SEGMENT = /(\/accounts\/)(?!\{account_id\}(?:[/?#\s"'\\]|$))[^/\s?#"'\\]+/gi
const BEARER_VALUE = /\b(bearer)\s+[^\s"',;]+/gi
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g

type RedactionContext = {
  readonly secretPattern: RegExp | null
  readonly ancestors: Set<object>
}

function buildSecretPattern(secrets: readonly string[]): RegExp | null {
  const variants = new Set<string>()
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH) {
      variants.add(secret)
      variants.add(encodeURIComponent(secret))
    }
  }
  if (variants.size === 0) {
    return null
  }
  // Longest first so a header value is replaced whole before its token part.
  const ordered = [...variants].sort((left, right) => right.length - left.length)
  return new RegExp(ordered.map((value) => value.replace(REGEXP_SPECIALS, '\\$&')).join('|'), 'gi')
}

function createContext(secrets: readonly string[]): RedactionContext {
  return { secretPattern: buildSecretPattern(secrets), ancestors: new Set() }
}

function scrubText(text: string, context: RedactionContext): string {
  const withoutSecrets = context.secretPattern
    ? text.replace(context.secretPattern, CLEF_REDACTED)
    : text
  return withoutSecrets
    .replace(ACCOUNT_SEGMENT, `$1${CLEF_REDACTED}`)
    .replace(BEARER_VALUE, `$1 ${CLEF_REDACTED}`)
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function printable(value: object, context: RedactionContext): string {
  try {
    return scrubText(String(value), context)
  } catch {
    return '[unprintable]'
  }
}

function copyErrorExtras(source: Error, copy: Error, context: RedactionContext, depth: number) {
  const errors: unknown = Reflect.get(source, 'errors')
  if (Array.isArray(errors)) {
    Object.defineProperty(copy, 'errors', {
      value: errors.map((entry) => redactNested(entry, context, depth + 1)),
      configurable: true,
      writable: true
    })
  }
  const code: unknown = Reflect.get(source, 'code')
  if (typeof code === 'string' || typeof code === 'number') {
    Object.defineProperty(copy, 'code', {
      value: typeof code === 'string' ? scrubText(code, context) : code,
      configurable: true,
      enumerable: true,
      writable: true
    })
  }
}

function copyError(error: Error, context: RedactionContext, depth: number): Error {
  const message = scrubText(String(error.message), context)
  const name = scrubText(String(error.name), context) || 'Error'
  const copy = new Error(message)
  copy.name = name
  const stack: unknown = error.stack
  copy.stack = typeof stack === 'string' ? scrubText(stack, context) : `${name}: ${message}`
  if (Object.hasOwn(error, 'cause')) {
    copy.cause = redactNested(error.cause, context, depth + 1)
  }
  copyErrorExtras(error, copy, context, depth)
  return copy
}

function redactObject(value: object, context: RedactionContext, depth: number): unknown {
  if (value instanceof Error) {
    return copyError(value, context, depth)
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => redactNested(entry, context, depth + 1))
  }
  if (!isPlainObject(value)) {
    return printable(value, context)
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      scrubText(key, context),
      redactNested(entry, context, depth + 1)
    ])
  )
}

function redactNested(value: unknown, context: RedactionContext, depth: number): unknown {
  if (typeof value === 'string') {
    return scrubText(value, context)
  }
  if (typeof value === 'function') {
    return '[function]'
  }
  if (typeof value === 'symbol') {
    return scrubText(value.toString(), context)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  if (context.ancestors.has(value)) {
    return '[circular]'
  }
  if (depth > MAX_VALUE_DEPTH) {
    return '[truncated]'
  }
  context.ancestors.add(value)
  try {
    return redactObject(value, context, depth)
  } finally {
    context.ancestors.delete(value)
  }
}

/** Scrubs live secret values, `/accounts/<id>` segments and bearer credentials. */
export function redactClefText(text: string, secrets: readonly string[] = []): string {
  return scrubText(text, createContext(secrets))
}

/** A new Error with scrubbed message, stack, code, aggregate errors and `cause` chain. */
export function redactClefError(error: Error, secrets: readonly string[] = []): Error {
  const context = createContext(secrets)
  context.ancestors.add(error)
  return copyError(error, context, 0)
}

/** Deep, cycle-safe scrub of any value; class instances collapse to their scrubbed string form. */
export function redactClefValue(value: unknown, secrets: readonly string[] = []): unknown {
  return redactNested(value, createContext(secrets), 0)
}

import { z } from 'zod'
import { hasSecretLikeText } from '../../../agent-exec-shared/secret-shapes'
import { OrchestrationError } from '../orchestration-error'

/** One JSON object with JSON values only; the bound on its serialized size is the column's. */
export const JsonObjectSchema = z.record(z.string(), z.json())
export type JsonObject = z.infer<typeof JsonObjectSchema>

const SCAN_DEPTH_LIMIT = 16

function holdsSecretLikeText(value: unknown, depth: number): boolean {
  if (typeof value === 'string') {
    return hasSecretLikeText(value)
  }
  if (depth >= SCAN_DEPTH_LIMIT) {
    // Why: a structure this deep was never built by the app, so it is refused rather than half scanned.
    return true
  }
  if (Array.isArray(value)) {
    return value.some((entry) => holdsSecretLikeText(entry, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    // Keys are written by app code, never by an agent, so only values are scanned.
    return Object.values(value).some((entry) => holdsSecretLikeText(entry, depth + 1))
  }
  return false
}

/** Refuses rather than masks, so a leak path is fixed at its source; the error never holds the text. */
export function assertNoSecretLikeText(value: unknown, field: string): void {
  if (holdsSecretLikeText(value, 0)) {
    throw new OrchestrationError(
      'autopilot_unredacted_text',
      `The ${field} still holds secret-shaped text. Redact it first; nothing was written.`,
      { field }
    )
  }
}

/** Serializes for a JSON column: free of secret-shaped text and within the column's bound. */
export function toJsonColumn(value: unknown, maxChars: number, field: string): string {
  assertNoSecretLikeText(value, field)
  const text = JSON.stringify(value)
  if (text === undefined || text.length > maxChars) {
    throw new OrchestrationError('autopilot_invalid_input', `The ${field} is too large.`, {
      fields: [field]
    })
  }
  return text
}

export function toNullableJsonColumn(
  value: unknown,
  maxChars: number,
  field: string
): string | null {
  return value === null || value === undefined ? null : toJsonColumn(value, maxChars, field)
}

/** A stored JSON column that no longer parses or fits its schema means the table was changed outside the store. */
export function parseJsonColumn<T>(text: unknown, schema: z.ZodType<T>, what: string): T {
  let parsed: unknown
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : undefined
  } catch {
    parsed = undefined
  }
  const checked = schema.safeParse(parsed)
  if (checked.success) {
    return checked.data
  }
  throw new OrchestrationError(
    'autopilot_recovery_required',
    `A stored ${what} column is unreadable. Nothing was changed.`
  )
}

export function parseNullableJsonColumn<T>(
  text: unknown,
  schema: z.ZodType<T>,
  what: string
): T | null {
  return text === null || text === undefined ? null : parseJsonColumn(text, schema, what)
}

/** Text that holds no control characters except tab and line feed; one definition with the TaskSpec. */
export { hasNoControlCharacters } from '../../../../shared/rpc-contract/autopilot-task-spec-fields'

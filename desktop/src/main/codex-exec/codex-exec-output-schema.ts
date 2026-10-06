import { z } from 'zod'
import { guardOutputSchema } from './codex-exec-output-schema-guard'
import { boundText } from '../agent-exec-shared/secret-redaction'

// The last message is re-validated here, not trusted; anything the validator cannot enforce or survive fails closed.

export type OutputSchemaCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: 'violation' | 'unvalidatable'; readonly detail: string }

export type CompiledOutputSchema =
  | { readonly ok: true; readonly validate: (text: string) => OutputSchemaCheck }
  | { readonly ok: false; readonly detail: string }

export type OutputSchemaOptions = {
  /** Longest message text that is parsed and validated. */
  readonly maxTextChars?: number
  /** Deepest JSON nesting handed to the validator, which recurses. */
  readonly maxValueDepth?: number
}

export const DEFAULT_MAX_VALIDATED_TEXT_CHARS = 1024 * 1024
export const DEFAULT_MAX_VALUE_DEPTH = 64
const MAX_DETAIL_CHARS = 400
const MAX_ISSUES_REPORTED = 5

function detailOf(text: string): string {
  return boundText(text, MAX_DETAIL_CHARS).text
}

function violation(detail: string): OutputSchemaCheck {
  return { ok: false, kind: 'violation', detail: detailOf(detail) }
}

/** True when the value nests deeper than `limit`; iterative, so a hostile document cannot overflow it. */
function nestsDeeperThan(value: unknown, limit: number): boolean {
  const stack: { readonly node: unknown; readonly depth: number }[] = [{ node: value, depth: 1 }]
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    if (frame.depth > limit) {
      return true
    }
    if (typeof frame.node === 'object' && frame.node !== null) {
      for (const child of Object.values(frame.node)) {
        stack.push({ node: child, depth: frame.depth + 1 })
      }
    }
  }
  return false
}

function validateText(
  compiled: z.ZodType,
  text: string,
  options: Required<OutputSchemaOptions>
): OutputSchemaCheck {
  if (text.length > options.maxTextChars) {
    return violation(
      `The final message is over ${options.maxTextChars} characters; it was not validated.`
    )
  }
  const trimmed = text.trim()
  if (trimmed === '') {
    return violation('The final message is empty.')
  }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return violation('The final message is not valid JSON.')
  }
  if (nestsDeeperThan(value, options.maxValueDepth)) {
    return violation(`The final message nests deeper than ${options.maxValueDepth} levels.`)
  }
  try {
    const result = compiled.safeParse(value)
    if (result.success) {
      return { ok: true }
    }
    // Paths and issue codes only: the offending value may be sensitive.
    const issues = result.error.issues
      .slice(0, MAX_ISSUES_REPORTED)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
    return violation(`Schema violation at ${issues.join('; ')}`)
  } catch {
    return { ok: false, kind: 'unvalidatable', detail: 'The validator failed on this document.' }
  }
}

/** Compile a JSON Schema into a validator for the final message text. */
export function compileOutputSchema(
  schema: Readonly<Record<string, unknown>>,
  options: OutputSchemaOptions = {}
): CompiledOutputSchema {
  const guarded = guardOutputSchema(schema)
  if (!guarded.ok) {
    return {
      ok: false,
      detail: detailOf(`The output schema cannot be validated locally: ${guarded.detail}`)
    }
  }
  let compiled: z.ZodType
  try {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: fromJSONSchema checks the document structurally and throws on any construct it cannot express, which is caught below.
    compiled = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0])
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unsupported schema'
    return {
      ok: false,
      detail: detailOf(`The output schema cannot be validated locally: ${reason}`)
    }
  }
  const resolved = {
    maxTextChars: options.maxTextChars ?? DEFAULT_MAX_VALIDATED_TEXT_CHARS,
    maxValueDepth: options.maxValueDepth ?? DEFAULT_MAX_VALUE_DEPTH
  }
  return { ok: true, validate: (text) => validateText(compiled, text, resolved) }
}

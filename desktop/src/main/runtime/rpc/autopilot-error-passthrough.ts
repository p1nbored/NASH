import { maskSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import { OrchestrationError } from '../orchestration/orchestration-error'

// D-016 refusals (autopilot_*, and dot_* of contract versions 1 and 2 plus the store's internal two)
// and Workbench refusals (workbench_*, via maskedRefusalWire) keep their code and data on the wire.
// Only OrchestrationErrors pass: their text is authored by our code. Even so, every string is masked
// and bounded, so a stray secret never reaches a client.

const PASSTHROUGH_CODE = /^(?:autopilot|dot)_[a-z0-9]+(?:_[a-z0-9]+)*$/
const MAX_CODE_CHARS = 96
const MAX_MESSAGE_CHARS = 500
const MAX_DATA_STRING_CHARS = 2_000
const MAX_DATA_DEPTH = 6
const MAX_DATA_ENTRIES = 64

export type PassthroughError = {
  readonly code: string
  readonly message: string
  readonly data?: unknown
}

function boundedText(text: string, max: number): string {
  return maskSecretLikeText(text).slice(0, max)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** A JSON copy with masked strings; cycles, functions and class instances are dropped. */
function sanitizeData(value: unknown, depth: number, seen: ReadonlySet<object>): unknown {
  if (value === null || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string') {
    return boundedText(value, MAX_DATA_STRING_CHARS)
  }
  if (depth >= MAX_DATA_DEPTH || typeof value !== 'object' || seen.has(value)) {
    return undefined
  }
  const nextSeen = new Set([...seen, value])
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DATA_ENTRIES)
      .map((entry) => sanitizeData(entry, depth + 1, nextSeen))
      .filter((entry) => entry !== undefined)
  }
  if (!isPlainRecord(value)) {
    return undefined
  }
  const entries = Object.entries(value)
    .slice(0, MAX_DATA_ENTRIES)
    .map(([key, entry]) => [key, sanitizeData(entry, depth + 1, nextSeen)] as const)
    .filter(([, entry]) => entry !== undefined)
  return Object.fromEntries(entries)
}

/** The wire parts of a refusal our code raised: masked, bounded message and data, the code as is. */
export function maskedRefusalWire(error: OrchestrationError): PassthroughError {
  const message = boundedText(error.message, MAX_MESSAGE_CHARS)
  if (error.data === undefined) {
    return { code: error.code, message }
  }
  const data = sanitizeData(error.data, 0, new Set())
  return data === undefined ? { code: error.code, message } : { code: error.code, message, data }
}

/** The wire parts of an autopilot or dot refusal, or null when the error is not one. */
export function autopilotErrorPassthrough(error: unknown): PassthroughError | null {
  if (
    !(error instanceof OrchestrationError) ||
    error.code.length > MAX_CODE_CHARS ||
    !PASSTHROUGH_CODE.test(error.code)
  ) {
    return null
  }
  return maskedRefusalWire(error)
}

import { boundText, redactAndBound, redactSecretLikeText } from './secret-redaction'

// The record kinds of an attempt transcript (design 1.1) and how one becomes a redacted, bounded JSON line.

/** `<runDir>/transcript.jsonl`; only the desktop reads it, never dot (RG6). */
export const ATTEMPT_TRANSCRIPT_FILE = 'transcript.jsonl'
export const TRANSCRIPT_FORMAT_VERSION = 1
export const TRANSCRIPT_TRIMMED_MARKER = '…[trimmed]'
export const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024
export const MAX_FILE_CHANGE_PATHS = 50
/** Every text field is redacted and cut to this before the record cap applies. */
const MAX_TEXT_CHARS = 8 * 1024
/** Extra text redacted before a tail cut, so a secret straddling the cut is seen whole. */
const REDACTION_MARGIN_CHARS = 512
/** Room for `{"v":1,"seq":<n>,`, which replaces the body's `{` when the record is written. */
const RECORD_PREFIX_RESERVE_BYTES = 32

export type TranscriptExecutor = 'codex' | 'agy'
export type TranscriptSandbox = 'read-only' | 'write'
export type TranscriptWorktree = {
  readonly branch: string
  readonly path: string
  readonly baseCommit: string
}
export type TranscriptUsage = {
  readonly inputTokens: number | null
  readonly cachedInputTokens: number | null
  readonly outputTokens: number | null
  readonly reasoningOutputTokens: number | null
}

export type TranscriptStart = {
  readonly executor: TranscriptExecutor
  readonly model: string
  readonly effort: string | null
  readonly sandbox: TranscriptSandbox
  readonly cwd: string
  readonly worktree: TranscriptWorktree | null
}

export type TranscriptEnd = {
  readonly state: string
  readonly exitCode: number | null
  readonly reasonCode: string | null
}

export type TranscriptRecord =
  | ({ readonly kind: 'start' } & TranscriptStart)
  | {
      readonly kind: 'command'
      readonly id: string | null
      readonly status: 'started' | 'completed' | 'failed'
      readonly command: string
      readonly exitCode: number | null
      readonly output: string | null
    }
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'file_change'; readonly status: string; readonly paths: readonly string[] }
  | { readonly kind: 'tool'; readonly itemType: string; readonly status: string }
  | {
      readonly kind: 'turn'
      readonly phase: 'started' | 'completed' | 'failed'
      readonly usage: TranscriptUsage | null
      readonly error: string | null
    }
  | { readonly kind: 'output'; readonly stream: 'stdout' | 'stderr'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string }
  | { readonly kind: 'note'; readonly code: 'records_dropped'; readonly count: number }
  | { readonly kind: 'note'; readonly code: 'truncated' }
  | ({ readonly kind: 'end' } & TranscriptEnd)

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value)
}

/** Apply `text` to every string, keeping the shape and key order. */
function mapStrings(value: JsonValue, text: (value: string) => string): JsonValue {
  if (typeof value === 'string') {
    return text(value)
  }
  if (isJsonArray(value)) {
    return value.map((entry) => mapStrings(entry, text))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, mapStrings(entry, text)])
    )
  }
  return value
}

function redactText(text: string): string {
  const bounded = redactAndBound(text, MAX_TEXT_CHARS)
  return bounded.truncated ? `${bounded.text}${TRANSCRIPT_TRIMMED_MARKER}` : bounded.text
}

function longestString(value: JsonValue): number {
  if (typeof value === 'string') {
    return value.length
  }
  if (isJsonArray(value)) {
    return value.reduce<number>((longest, entry) => Math.max(longest, longestString(entry)), 0)
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce<number>(
      (longest, entry) => Math.max(longest, longestString(entry)),
      0
    )
  }
  return 0
}

const cappedTo = (cap: number) => (text: string) =>
  text.length > cap ? `${boundText(text, cap).text}${TRANSCRIPT_TRIMMED_MARKER}` : text

/**
 * The record body as JSON, `at` first, fitting the record cap with the prefix added later; longer
 * text is cut longest-first and ends with the trimmed marker. Null when even empty text cannot fit.
 */
export function serializeTranscriptRecord(
  record: TranscriptRecord,
  at: string,
  maxRecordBytes: number
): string | null {
  const { kind, ...fields } = record
  const redacted = mapStrings(fields, redactText)
  const budget = maxRecordBytes - RECORD_PREFIX_RESERVE_BYTES - 1
  const render = (value: JsonValue): string => JSON.stringify({ at, kind, ...Object(value) })
  const fits = (json: string) => Buffer.byteLength(json) <= budget
  const whole = render(redacted)
  if (fits(whole)) {
    return whole
  }
  const shortest = render(mapStrings(redacted, cappedTo(0)))
  if (!fits(shortest)) {
    return null
  }
  // Largest per-string cap that fits: the longest strings are cut first and evenly.
  let low = 0
  let high = longestString(redacted)
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(render(mapStrings(redacted, cappedTo(middle))))) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return render(mapStrings(redacted, cappedTo(low)))
}

/** The redacted last `maxBytes` of a text, cut on a character boundary. */
export function redactedTail(text: string, maxBytes: number): string {
  const windowChars = maxBytes + REDACTION_MARGIN_CHARS
  const window = text.length > windowChars ? text.slice(text.length - windowChars) : text
  const bytes = Buffer.from(redactSecretLikeText(window), 'utf8')
  if (bytes.length <= maxBytes) {
    return bytes.toString('utf8')
  }
  let start = bytes.length - maxBytes
  // Skip UTF-8 continuation bytes so the tail starts on a whole character.
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) {
    start += 1
  }
  return bytes.subarray(start).toString('utf8')
}

/** The verdict shape both runners share. */
export type TranscriptVerdict =
  | { readonly status: 'completed' }
  | { readonly status: 'failed'; readonly failures: readonly { readonly kind: string }[] }
  | { readonly status: 'blocked'; readonly reason: string }

/** The `end` record of a runner verdict: its status, and the primary failure or block reason as a code. */
export function transcriptEndOf(
  verdict: TranscriptVerdict,
  exitCode: number | null
): TranscriptEnd {
  switch (verdict.status) {
    case 'completed':
      return { state: 'completed', exitCode, reasonCode: null }
    case 'failed':
      return { state: 'failed', exitCode, reasonCode: verdict.failures[0]?.kind ?? null }
    case 'blocked':
      return { state: 'blocked', exitCode, reasonCode: verdict.reason }
  }
}

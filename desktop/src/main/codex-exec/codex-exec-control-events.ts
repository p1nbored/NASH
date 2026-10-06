// The stream events the completion rule depends on, and how to spot one in text that never parsed.

/** Losing any of these makes the stream unreliable. */
export const CODEX_EXEC_CONTROL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'thread.started',
  'turn.completed',
  'turn.failed',
  'error'
])

const TYPE_HINT = /^\s*\{\s*"type"\s*:\s*"([A-Za-z0-9._-]{1,64})"/
const CONTROL_TYPE_ANYWHERE =
  /"type"\s*:\s*"(?:thread\.started|turn\.completed|turn\.failed|error)"/

/** The `type` of an oversized line, read from its first key only; null when it cannot be read. */
export function typeHintOf(prefix: string): string | null {
  return TYPE_HINT.exec(prefix)?.[1] ?? null
}

/** An oversized line whose type is unreadable counts as a possible control event: fail closed. */
export function oversizedLineMayBeControl(typeHint: string | null): boolean {
  return typeHint === null || CODEX_EXEC_CONTROL_EVENT_TYPES.has(typeHint)
}

/** True when text that did not parse still names a control event type, even behind noise. */
export function looksLikeControlEvent(text: string): boolean {
  return CONTROL_TYPE_ANYWHERE.test(text)
}

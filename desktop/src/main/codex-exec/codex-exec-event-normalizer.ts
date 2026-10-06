import { isCodexExecModelSlug } from './codex-exec-argv'
import { redactAndBound } from '../agent-exec-shared/secret-redaction'
import type { CodexExecUsage } from './codex-exec-types'

// Turns one stdout line of `codex exec --json` into a normalized event; reasoning never leaves here.

export type CodexExecItemPhase = 'started' | 'updated' | 'completed'

export type CodexExecNormalizedEvent =
  | { readonly kind: 'thread_started'; readonly threadId: string }
  | { readonly kind: 'turn_started' }
  | {
      readonly kind: 'item'
      readonly phase: CodexExecItemPhase
      readonly itemType: string
      readonly itemId: string | null
      readonly status: string | null
      readonly summary: string | null
    }
  | { readonly kind: 'turn_completed'; readonly usage: CodexExecUsage | null }
  | { readonly kind: 'turn_failed'; readonly message: string | null }
  | { readonly kind: 'error'; readonly message: string | null }
  | {
      readonly kind: 'unknown'
      readonly eventType: string
      readonly raw: string
      readonly rawTruncated: boolean
    }

export type NonJsonReason = 'invalid_json' | 'not_an_object' | 'missing_type'

export type NormalizedLine =
  | {
      readonly kind: 'event'
      readonly event: CodexExecNormalizedEvent
      readonly reportedModel: string | null
    }
  | { readonly kind: 'reasoning_omitted' }
  | { readonly kind: 'non_json'; readonly reason: NonJsonReason; readonly preview: string }

/** Letters and digits first, then a few separators: an id can never read as a flag or hold spaces. */
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_MESSAGE_CHARS = 500
const MAX_SUMMARY_CHARS = 300
const MAX_PREVIEW_CHARS = 200
const MAX_RAW_EVENT_CHARS = 2048
const MAX_FILE_CHANGE_PATHS = 20
const MAX_ITEM_ID_CHARS = 128
const MAX_LABEL_CHARS = 64
const ITEM_PHASES: Readonly<Record<string, CodexExecItemPhase>> = {
  'item.started': 'started',
  'item.updated': 'updated',
  'item.completed': 'completed'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringField(record: Record<string, unknown>, name: string): string | null {
  const value = record[name]
  return typeof value === 'string' ? value : null
}

/** Cut an untrusted identifier-like string and blank C0 and DEL characters; the cut comes first. */
export function boundedLabel(value: string, maxChars: number): string {
  const cut = value.length > maxChars ? value.slice(0, maxChars) : value
  return Array.from(cut, (char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7f ? '?' : char
  }).join('')
}

function boundedField(
  record: Record<string, unknown>,
  name: string,
  maxChars: number
): string | null {
  const value = stringField(record, name)
  return value === null ? null : boundedLabel(value, maxChars)
}

function boundedMessage(value: string | null): string | null {
  return value === null ? null : redactAndBound(value, MAX_MESSAGE_CHARS).text
}

export function readUsage(value: unknown): CodexExecUsage | null {
  if (!isRecord(value)) {
    return null
  }
  const count = (name: string): number | null => {
    const field = value[name]
    return typeof field === 'number' && Number.isSafeInteger(field) && field >= 0 ? field : null
  }
  return {
    inputTokens: count('input_tokens'),
    cachedInputTokens: count('cached_input_tokens'),
    outputTokens: count('output_tokens'),
    reasoningOutputTokens: count('reasoning_output_tokens')
  }
}

export function isReasoning(type: string, record: Record<string, unknown>): boolean {
  if (type.toLowerCase().includes('reasoning')) {
    return true
  }
  const item = record.item
  return isRecord(item) && item.type === 'reasoning'
}

/** A command line or the changed paths: enough to audit what ran, never output or content. */
function summarizeItem(itemType: string, item: Record<string, unknown>): string | null {
  if (itemType === 'command_execution') {
    const command = stringField(item, 'command')
    return command === null ? null : redactAndBound(command, MAX_SUMMARY_CHARS).text
  }
  if (itemType === 'file_change' && Array.isArray(item.changes)) {
    const paths = item.changes
      .flatMap((change: unknown) => (isRecord(change) ? [stringField(change, 'path')] : []))
      .filter((path): path is string => path !== null)
      .slice(0, MAX_FILE_CHANGE_PATHS)
    return paths.length === 0 ? null : redactAndBound(paths.join(', '), MAX_SUMMARY_CHARS).text
  }
  return null
}

function normalizeItem(
  phase: CodexExecItemPhase,
  record: Record<string, unknown>
): Extract<CodexExecNormalizedEvent, { kind: 'item' }> {
  const item = isRecord(record.item) ? record.item : {}
  const itemType = boundedField(item, 'type', MAX_LABEL_CHARS) ?? 'unknown'
  return {
    kind: 'item',
    phase,
    itemType,
    itemId: boundedField(item, 'id', MAX_ITEM_ID_CHARS),
    status: boundedField(item, 'status', MAX_LABEL_CHARS),
    summary: summarizeItem(itemType, item)
  }
}

function unknownEvent(type: string, text: string): CodexExecNormalizedEvent {
  const bounded = redactAndBound(text, MAX_RAW_EVENT_CHARS)
  return {
    kind: 'unknown',
    eventType: boundedLabel(type, MAX_LABEL_CHARS),
    raw: bounded.text,
    rawTruncated: bounded.truncated
  }
}

function normalizeKnown(
  type: string,
  record: Record<string, unknown>,
  text: string
): CodexExecNormalizedEvent {
  const phase = ITEM_PHASES[type]
  if (phase !== undefined && Object.hasOwn(ITEM_PHASES, type)) {
    return normalizeItem(phase, record)
  }
  switch (type) {
    case 'thread.started': {
      const threadId = stringField(record, 'thread_id')
      return threadId !== null && THREAD_ID_PATTERN.test(threadId)
        ? { kind: 'thread_started', threadId }
        : unknownEvent(type, text)
    }
    case 'turn.started':
      return { kind: 'turn_started' }
    case 'turn.completed':
      return { kind: 'turn_completed', usage: readUsage(record.usage) }
    case 'turn.failed': {
      const error = record.error
      return {
        kind: 'turn_failed',
        message: boundedMessage(isRecord(error) ? stringField(error, 'message') : null)
      }
    }
    case 'error':
      return { kind: 'error', message: boundedMessage(stringField(record, 'message')) }
    default:
      return unknownEvent(type, text)
  }
}

function reportedModelOf(record: Record<string, unknown>): string | null {
  const model = stringField(record, 'model')
  return model !== null && isCodexExecModelSlug(model) ? model : null
}

function nonJson(reason: NonJsonReason, text: string): NormalizedLine {
  return { kind: 'non_json', reason, preview: redactAndBound(text, MAX_PREVIEW_CHARS).text }
}

export function normalizeCodexExecLine(text: string): NormalizedLine {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return nonJson('invalid_json', text)
  }
  if (!isRecord(parsed)) {
    return nonJson('not_an_object', text)
  }
  const type = stringField(parsed, 'type')
  if (type === null || type === '') {
    return nonJson('missing_type', text)
  }
  if (isReasoning(type, parsed)) {
    return { kind: 'reasoning_omitted' }
  }
  return {
    kind: 'event',
    event: normalizeKnown(type, parsed, text),
    reportedModel: reportedModelOf(parsed)
  }
}

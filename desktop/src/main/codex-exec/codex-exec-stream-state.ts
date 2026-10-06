import {
  looksLikeControlEvent,
  oversizedLineMayBeControl,
  typeHintOf
} from './codex-exec-control-events'
import {
  normalizeCodexExecLine,
  type CodexExecNormalizedEvent,
  type NonJsonReason,
  type NormalizedLine
} from './codex-exec-event-normalizer'
import type { JsonlLine } from './codex-exec-jsonl-line-reader'
import type { CodexExecUsage } from './codex-exec-types'

export type CodexExecStreamLimits = {
  readonly maxEvents: number
  readonly maxUnknownEvents: number
  readonly maxNonJsonSamples: number
  readonly maxOversizedSamples: number
  readonly maxFailureMessages: number
}

export const DEFAULT_STREAM_LIMITS: CodexExecStreamLimits = {
  maxEvents: 500,
  maxUnknownEvents: 32,
  maxNonJsonSamples: 20,
  maxOversizedSamples: 20,
  maxFailureMessages: 10
}

const MAX_THREAD_IDS_RETAINED = 4
const MAX_ITEM_COUNT_KEYS = 64
const ITEM_COUNT_KEY = /^[A-Za-z0-9._-]{1,64}$/
const OTHER_ITEM_BUCKET = 'other'

export type TerminalEventKind = 'turn.completed' | 'turn.failed' | 'error'

export type UnknownEventRecord = {
  readonly eventType: string
  readonly raw: string
  readonly rawTruncated: boolean
}

export type NonJsonLineRecord = {
  readonly lineNumber: number
  readonly reason: NonJsonReason
  readonly preview: string
}

export type OversizedLineRecord = {
  readonly lineNumber: number
  readonly totalBytes: number
  readonly typeHint: string | null
}

/** Immutable snapshot of what the stream has shown so far. */
export type CodexExecStreamSummary = {
  readonly eventCount: number
  readonly threadStartedCount: number
  readonly threadIds: readonly string[]
  readonly turnStartedCount: number
  readonly turnCompletedCount: number
  readonly turnFailedCount: number
  readonly errorEventCount: number
  readonly finalTurnEvent: TerminalEventKind | null
  readonly usage: CodexExecUsage | null
  readonly failureMessages: readonly string[]
  /** Null-prototype record keyed by a restricted item type; anything else counts under `other`. */
  readonly itemCounts: Readonly<Record<string, number>>
  readonly reasoningItemsOmitted: number
  readonly unknownEventCount: number
  readonly unknownEvents: readonly UnknownEventRecord[]
  readonly nonJsonLineCount: number
  readonly nonJsonLines: readonly NonJsonLineRecord[]
  readonly oversizedLineCount: number
  readonly oversizedLines: readonly OversizedLineRecord[]
  /** An oversized line was, or could not be ruled out as, a control event. */
  readonly oversizedControlEvent: boolean
  /** A line that did not parse still named a control event type. */
  readonly malformedControlEvent: boolean
  readonly reportedModel: string | null
  readonly events: readonly CodexExecNormalizedEvent[]
  readonly droppedEvents: number
}

export type CodexExecStreamState = {
  /** Fold one line in; returns the normalized event it produced, if any. */
  acceptLine: (line: JsonlLine) => CodexExecNormalizedEvent | null
  summary: () => CodexExecStreamSummary
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] }
type Accumulator = Omit<Mutable<CodexExecStreamSummary>, 'itemCounts'> & {
  itemCounts: Map<string, number>
}
type TextLine = Extract<JsonlLine, { kind: 'line' }>
type OversizedLine = Extract<JsonlLine, { kind: 'oversized' }>

function emptyAccumulator(): Accumulator {
  return {
    eventCount: 0,
    threadStartedCount: 0,
    threadIds: [],
    turnStartedCount: 0,
    turnCompletedCount: 0,
    turnFailedCount: 0,
    errorEventCount: 0,
    finalTurnEvent: null,
    usage: null,
    failureMessages: [],
    itemCounts: new Map(),
    reasoningItemsOmitted: 0,
    unknownEventCount: 0,
    unknownEvents: [],
    nonJsonLineCount: 0,
    nonJsonLines: [],
    oversizedLineCount: 0,
    oversizedLines: [],
    oversizedControlEvent: false,
    malformedControlEvent: false,
    reportedModel: null,
    events: [],
    droppedEvents: 0
  }
}

function resolveStreamLimits(overrides: Partial<CodexExecStreamLimits>): CodexExecStreamLimits {
  return {
    maxEvents: overrides.maxEvents ?? DEFAULT_STREAM_LIMITS.maxEvents,
    maxUnknownEvents: overrides.maxUnknownEvents ?? DEFAULT_STREAM_LIMITS.maxUnknownEvents,
    maxNonJsonSamples: overrides.maxNonJsonSamples ?? DEFAULT_STREAM_LIMITS.maxNonJsonSamples,
    maxOversizedSamples: overrides.maxOversizedSamples ?? DEFAULT_STREAM_LIMITS.maxOversizedSamples,
    maxFailureMessages: overrides.maxFailureMessages ?? DEFAULT_STREAM_LIMITS.maxFailureMessages
  }
}

function countItem(acc: Accumulator, itemType: string): void {
  const known = acc.itemCounts.has(itemType)
  const usable =
    ITEM_COUNT_KEY.test(itemType) && (known || acc.itemCounts.size < MAX_ITEM_COUNT_KEYS)
  const key = usable ? itemType : OTHER_ITEM_BUCKET
  acc.itemCounts.set(key, (acc.itemCounts.get(key) ?? 0) + 1)
}

function recordFailureMessage(
  acc: Accumulator,
  limits: CodexExecStreamLimits,
  message: string | null
) {
  if (message !== null && acc.failureMessages.length < limits.maxFailureMessages) {
    acc.failureMessages.push(message)
  }
}

function foldEvent(
  acc: Accumulator,
  limits: CodexExecStreamLimits,
  event: CodexExecNormalizedEvent
): void {
  switch (event.kind) {
    case 'thread_started':
      acc.threadStartedCount += 1
      if (acc.threadIds.length < MAX_THREAD_IDS_RETAINED) {
        acc.threadIds.push(event.threadId)
      }
      return
    case 'turn_started':
      acc.turnStartedCount += 1
      return
    case 'item':
      countItem(acc, event.itemType)
      return
    case 'turn_completed':
      acc.turnCompletedCount += 1
      acc.finalTurnEvent = 'turn.completed'
      acc.usage = event.usage
      return
    case 'turn_failed':
      acc.turnFailedCount += 1
      acc.finalTurnEvent = 'turn.failed'
      recordFailureMessage(acc, limits, event.message)
      return
    case 'error':
      acc.errorEventCount += 1
      acc.finalTurnEvent = 'error'
      recordFailureMessage(acc, limits, event.message)
      return
    case 'unknown':
      acc.unknownEventCount += 1
      if (acc.unknownEvents.length < limits.maxUnknownEvents) {
        const { eventType, raw, rawTruncated } = event
        acc.unknownEvents.push({ eventType, raw, rawTruncated })
      }
  }
}

function recordOversized(acc: Accumulator, limits: CodexExecStreamLimits, line: OversizedLine) {
  const typeHint = typeHintOf(line.prefix)
  acc.oversizedLineCount += 1
  if (oversizedLineMayBeControl(typeHint)) {
    acc.oversizedControlEvent = true
  }
  if (acc.oversizedLines.length < limits.maxOversizedSamples) {
    acc.oversizedLines.push({ lineNumber: line.lineNumber, totalBytes: line.totalBytes, typeHint })
  }
}

function recordNonJson(
  acc: Accumulator,
  limits: CodexExecStreamLimits,
  line: TextLine,
  normalized: Extract<NormalizedLine, { kind: 'non_json' }>
): void {
  acc.nonJsonLineCount += 1
  // Only text that failed to parse can hide a control event; valid JSON was already classified.
  if (normalized.reason === 'invalid_json' && looksLikeControlEvent(line.text)) {
    acc.malformedControlEvent = true
  }
  if (acc.nonJsonLines.length < limits.maxNonJsonSamples) {
    acc.nonJsonLines.push({
      lineNumber: line.lineNumber,
      reason: normalized.reason,
      preview: normalized.preview
    })
  }
}

function recordEvent(
  acc: Accumulator,
  limits: CodexExecStreamLimits,
  normalized: Extract<NormalizedLine, { kind: 'event' }>
): CodexExecNormalizedEvent {
  acc.eventCount += 1
  acc.reportedModel ??= normalized.reportedModel
  foldEvent(acc, limits, normalized.event)
  if (acc.events.length < limits.maxEvents) {
    acc.events.push(normalized.event)
  } else {
    acc.droppedEvents += 1
  }
  return normalized.event
}

function acceptLine(
  acc: Accumulator,
  limits: CodexExecStreamLimits,
  line: JsonlLine
): CodexExecNormalizedEvent | null {
  if (line.kind === 'oversized') {
    recordOversized(acc, limits, line)
    return null
  }
  const normalized = normalizeCodexExecLine(line.text)
  switch (normalized.kind) {
    case 'reasoning_omitted':
      acc.reasoningItemsOmitted += 1
      return null
    case 'non_json':
      recordNonJson(acc, limits, line, normalized)
      return null
    case 'event':
      return recordEvent(acc, limits, normalized)
  }
}

function toCountRecord(counts: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  const record: Record<string, number> = Object.create(null)
  for (const [key, count] of counts) {
    record[key] = count
  }
  return record
}

function snapshotOf(acc: Accumulator): CodexExecStreamSummary {
  return {
    ...acc,
    threadIds: [...acc.threadIds],
    failureMessages: [...acc.failureMessages],
    itemCounts: toCountRecord(acc.itemCounts),
    unknownEvents: [...acc.unknownEvents],
    nonJsonLines: [...acc.nonJsonLines],
    oversizedLines: [...acc.oversizedLines],
    events: [...acc.events]
  }
}

export function createCodexExecStreamState(
  limitOverrides: Partial<CodexExecStreamLimits> = {}
): CodexExecStreamState {
  const limits = resolveStreamLimits(limitOverrides)
  const acc = emptyAccumulator()
  return {
    acceptLine: (line) => acceptLine(acc, limits, line),
    summary: () => snapshotOf(acc)
  }
}

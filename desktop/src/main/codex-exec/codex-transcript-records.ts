import type { TranscriptSink } from '../agent-exec-shared/attempt-transcript'
import {
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_FILE_CHANGE_PATHS,
  redactedTail,
  type TranscriptRecord,
  type TranscriptStart,
  type TranscriptWorktree
} from '../agent-exec-shared/attempt-transcript-records'
import {
  boundedLabel,
  isReasoning,
  isRecord,
  readUsage,
  stringField
} from './codex-exec-event-normalizer'
import type { CodexExecApplied } from './codex-exec-types'

// Maps one `codex exec --json` stdout line to attempt-transcript records (design 1.1). Reasoning is
// never written; other tool items keep only their type and status, never arguments or results.

type ItemPhase = 'started' | 'updated' | 'completed'
type Json = Record<string, unknown>

const MAX_LABEL_CHARS = 64
const MAX_ID_CHARS = 128
const ITEM_PHASES: Readonly<Record<string, ItemPhase>> = {
  'item.started': 'started',
  'item.updated': 'updated',
  'item.completed': 'completed'
}
const FAILED_COMMAND_STATUSES: ReadonlySet<string> = new Set(['failed', 'declined'])

function label(record: Json, name: string, maxChars = MAX_LABEL_CHARS): string | null {
  const value = stringField(record, name)
  return value === null ? null : boundedLabel(value, maxChars)
}

function exitCodeOf(item: Json): number | null {
  const value = item.exit_code
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function commandRecords(phase: ItemPhase, item: Json): TranscriptRecord[] {
  if (phase === 'updated') {
    return []
  }
  const status = item.status
  const failed = typeof status === 'string' && FAILED_COMMAND_STATUSES.has(status)
  const output = stringField(item, 'aggregated_output')
  return [
    {
      kind: 'command',
      id: label(item, 'id', MAX_ID_CHARS),
      status: phase === 'started' ? 'started' : failed ? 'failed' : 'completed',
      command: stringField(item, 'command') ?? '',
      exitCode: exitCodeOf(item),
      output:
        phase === 'completed' && output !== null
          ? redactedTail(output, MAX_COMMAND_OUTPUT_BYTES)
          : null
    }
  ]
}

function changedPaths(item: Json): string[] {
  const changes = Array.isArray(item.changes) ? item.changes : []
  return changes
    .flatMap((change: unknown) => (isRecord(change) ? [stringField(change, 'path')] : []))
    .filter((path): path is string => path !== null)
    .slice(0, MAX_FILE_CHANGE_PATHS)
}

function itemRecords(phase: ItemPhase, item: Json): TranscriptRecord[] {
  const itemType = label(item, 'type') ?? 'unknown'
  const status = label(item, 'status') ?? phase
  switch (itemType) {
    case 'command_execution':
      return commandRecords(phase, item)
    case 'agent_message':
      return phase === 'completed'
        ? [{ kind: 'message', text: stringField(item, 'text') ?? '' }]
        : []
    case 'file_change':
      return [{ kind: 'file_change', status, paths: changedPaths(item) }]
    case 'error':
      return phase === 'completed'
        ? [{ kind: 'error', text: stringField(item, 'message') ?? '' }]
        : []
    default:
      return [{ kind: 'tool', itemType, status }]
  }
}

function eventRecords(type: string, event: Json): TranscriptRecord[] {
  const phase = ITEM_PHASES[type]
  if (phase !== undefined && Object.hasOwn(ITEM_PHASES, type)) {
    return isRecord(event.item) ? itemRecords(phase, event.item) : []
  }
  switch (type) {
    case 'turn.started':
      return [{ kind: 'turn', phase: 'started', usage: null, error: null }]
    case 'turn.completed':
      return [{ kind: 'turn', phase: 'completed', usage: readUsage(event.usage), error: null }]
    case 'turn.failed': {
      const error = isRecord(event.error) ? stringField(event.error, 'message') : null
      return [{ kind: 'turn', phase: 'failed', usage: null, error }]
    }
    case 'error':
      return [{ kind: 'error', text: stringField(event, 'message') ?? '' }]
    default:
      return []
  }
}

/** Records for one whole stdout line; a line that is not a typed JSON event is kept as stdout text. */
export function codexTranscriptRecords(line: string): readonly TranscriptRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    parsed = null
  }
  const type = isRecord(parsed) ? stringField(parsed, 'type') : null
  if (!isRecord(parsed) || type === null || type === '') {
    return [{ kind: 'output', stream: 'stdout', text: line }]
  }
  return isReasoning(type, parsed) ? [] : eventRecords(type, parsed)
}

/** Called from the stdout line handler: it must never throw into the pipe. */
export function appendCodexStdoutLine(sink: TranscriptSink, line: string): void {
  try {
    for (const record of codexTranscriptRecords(line)) {
      sink.append(record)
    }
  } catch {
    sink.fault()
  }
}

/** The `start` record of a Codex attempt, from the argv actually applied. */
export function codexTranscriptStart(
  applied: CodexExecApplied,
  cwd: string,
  worktree: TranscriptWorktree | null = null
): TranscriptStart {
  return {
    executor: 'codex',
    model: applied.model,
    effort: applied.effort,
    // No --sandbox (null) leaves codex exec's documented default, read-only.
    sandbox: applied.sandbox === 'workspace-write' ? 'write' : 'read-only',
    cwd,
    worktree
  }
}

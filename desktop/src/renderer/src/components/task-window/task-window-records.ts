// D-024 transcript records (design section 1.1), read defensively: an unknown kind or a broken
// line becomes a neutral row and never throws, because a newer writer may add kinds.

type Base = { readonly line: number; readonly at: string | null }

export type TranscriptWorktree = { branch: string; path: string; baseCommit: string }
export type TurnUsage = { input: number | null; cachedInput: number | null; output: number | null }

export type TranscriptRecord =
  | (Base & {
      kind: 'start'
      executor: string | null
      model: string | null
      effort: string | null
      sandbox: string | null
      cwd: string | null
      worktree: TranscriptWorktree | null
    })
  | (Base & {
      kind: 'command'
      /** Null when the CLI item had no id; such a command is never merged. */
      id: string | null
      status: string
      command: string
      exitCode: number | null
      output: string | null
    })
  | (Base & { kind: 'message'; text: string })
  | (Base & { kind: 'file_change'; status: string; paths: string[] })
  | (Base & { kind: 'tool'; itemType: string; status: string })
  | (Base & { kind: 'turn'; phase: string; usage: TurnUsage | null; error: string | null })
  | (Base & { kind: 'output'; stream: 'stdout' | 'stderr'; text: string })
  | (Base & { kind: 'error'; text: string })
  | (Base & { kind: 'note'; code: string; count: number | null })
  | (Base & { kind: 'end'; state: string; exitCode: number | null; reasonCode: string | null })
  | (Base & { kind: 'unknown'; recordKind: string })
  | { kind: 'malformed'; line: number; text: string }

const MALFORMED_TEXT_MAX = 240

type Fields = Readonly<Record<string, unknown>>

function str(fields: Fields, key: string): string | null {
  const value = fields[key]
  return typeof value === 'string' ? value : null
}

function num(fields: Fields, key: string): number | null {
  const value = fields[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function objectOf(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function usageOf(value: unknown): TurnUsage | null {
  const fields = objectOf(value)
  if (!fields) {
    return null
  }
  return {
    input: num(fields, 'input_tokens') ?? num(fields, 'inputTokens'),
    cachedInput: num(fields, 'cached_input_tokens') ?? num(fields, 'cachedInputTokens'),
    output: num(fields, 'output_tokens') ?? num(fields, 'outputTokens')
  }
}

function worktreeOf(value: unknown): TranscriptWorktree | null {
  const fields = objectOf(value)
  const branch = fields ? str(fields, 'branch') : null
  const path = fields ? str(fields, 'path') : null
  const baseCommit = fields ? str(fields, 'baseCommit') : null
  return branch !== null && path !== null && baseCommit !== null
    ? { branch, path, baseCommit }
    : null
}

/** The known kinds; each returns null when a field the row needs is missing. */
function knownRecord(kind: string, f: Fields, base: Base): TranscriptRecord | null | undefined {
  switch (kind) {
    case 'start':
      return {
        ...base,
        kind,
        executor: str(f, 'executor'),
        model: str(f, 'model'),
        effort: str(f, 'effort'),
        sandbox: str(f, 'sandbox'),
        cwd: str(f, 'cwd'),
        worktree: worktreeOf(f.worktree)
      }
    case 'command': {
      const command = str(f, 'command')
      return command === null
        ? null
        : {
            ...base,
            kind,
            id: str(f, 'id'),
            command,
            status: str(f, 'status') ?? '',
            exitCode: num(f, 'exitCode'),
            output: str(f, 'output')
          }
    }
    case 'message':
    case 'error': {
      const text = str(f, 'text')
      return text === null ? null : { ...base, kind, text }
    }
    case 'file_change': {
      const paths = Array.isArray(f.paths) ? f.paths.filter((p) => typeof p === 'string') : []
      return { ...base, kind, status: str(f, 'status') ?? '', paths }
    }
    case 'tool':
      return { ...base, kind, itemType: str(f, 'itemType') ?? '', status: str(f, 'status') ?? '' }
    case 'turn':
      return {
        ...base,
        kind,
        phase: str(f, 'phase') ?? '',
        usage: usageOf(f.usage),
        error: str(f, 'error')
      }
    case 'output': {
      const text = str(f, 'text')
      const stream = f.stream === 'stderr' ? 'stderr' : 'stdout'
      return text === null ? null : { ...base, kind, stream, text }
    }
    case 'note':
      return { ...base, kind, code: str(f, 'code') ?? '', count: num(f, 'count') }
    case 'end':
      return {
        ...base,
        kind,
        state: str(f, 'state') ?? '',
        exitCode: num(f, 'exitCode'),
        reasonCode: str(f, 'reasonCode')
      }
    default:
      return undefined
  }
}

function malformed(text: string, line: number): TranscriptRecord {
  return { kind: 'malformed', line, text: text.slice(0, MALFORMED_TEXT_MAX) }
}

export function parseTranscriptLine(text: string, line: number): TranscriptRecord {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return malformed(text, line)
  }
  const fields = objectOf(value)
  const kind = fields ? str(fields, 'kind') : null
  if (!fields || kind === null) {
    return malformed(text, line)
  }
  const base: Base = { line, at: str(fields, 'at') }
  const record = knownRecord(kind, fields, base)
  if (record === undefined) {
    return { ...base, kind: 'unknown', recordKind: kind.slice(0, 64) }
  }
  return record ?? malformed(text, line)
}

/** One row per record, except that a command's later records update its first row (task-window-row-log). */
export type TranscriptRow = TranscriptRecord & { readonly key: string }

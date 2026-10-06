// FIXTURE_ONLY transcripts and attempts for the task window tests; no runtime or file is read.
import type { WorkbenchRunTaskAttempt } from '../../../../shared/rpc-contract/workbench-task-window-params'
import type { OpenTaskWindowState } from './task-window-tab'

let seq = 0
export function resetFixtureSeq(): void {
  seq = 0
}

export function rec(kind: string, extra: Record<string, unknown> = {}): string {
  const at = new Date(Date.UTC(2026, 9, 5, 18, 0, seq)).toISOString()
  const line = JSON.stringify({ v: 1, seq, at, kind, ...extra })
  seq += 1
  return `${line}\n`
}

export function codexStart(): string {
  return rec('start', {
    executor: 'codex',
    model: 'gpt-6.1-sol',
    effort: 'max',
    sandbox: 'read-only',
    cwd: 'C:/fixtures/autopilot',
    worktree: null
  })
}

/** One of every Codex record kind, plus an unknown kind and a broken line. */
export function everyKindTranscript(): string {
  return [
    codexStart(),
    rec('turn', { phase: 'started', usage: null, error: null }),
    rec('command', {
      id: 'item_1',
      status: 'started',
      command: 'pnpm test receipt',
      exitCode: null,
      output: null
    }),
    rec('command', {
      id: 'item_1',
      status: 'completed',
      command: 'pnpm test receipt',
      exitCode: 0,
      output: 'FIXTURE_ONLY 12 tests passed'
    }),
    rec('message', { text: 'The parser rejects receipts without a signature.' }),
    rec('file_change', { status: 'completed', paths: ['contracts/receipt.ts'] }),
    rec('tool', { itemType: 'web_search', status: 'completed' }),
    rec('turn', {
      phase: 'completed',
      usage: { input_tokens: 1200, cached_input_tokens: 300, output_tokens: 450 },
      error: null
    }),
    rec('output', { stream: 'stderr', text: 'FIXTURE_ONLY deprecation warning' }),
    rec('error', { text: 'Reconnecting to the model.' }),
    rec('note', { code: 'records_dropped', count: 4 }),
    rec('reasoning_digest', { text: 'never shown' }),
    '{"v":1,"seq":99,"kind":"message","text":\n',
    rec('end', { state: 'completed', exitCode: 0, reasonCode: null })
  ].join('')
}

export function attempt(
  dispatchId: string,
  overrides: Partial<WorkbenchRunTaskAttempt> = {}
): WorkbenchRunTaskAttempt {
  return {
    dispatchId,
    state: 'running',
    startedAt: '2026-10-05T18:00:00.000Z',
    settledAt: null,
    hasTranscript: true,
    worktree: null,
    ...overrides
  }
}

export function windowState(overrides: Partial<OpenTaskWindowState> = {}): OpenTaskWindowState {
  return {
    runId: 'run_fixture01',
    taskId: 'task_fixture01',
    title: 'Review the parser',
    executorKind: 'codex',
    attempts: [attempt('ctx_fixture01')],
    selectedDispatchId: 'ctx_fixture01',
    ...overrides
  }
}

export function readResult(
  chunk: string,
  from: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    chunk,
    nextByteOffset: from + new TextEncoder().encode(chunk).length,
    fileIdentity: 'fixture-identity',
    reset: false,
    truncated: false,
    live: true,
    ended: false,
    ...overrides
  }
}

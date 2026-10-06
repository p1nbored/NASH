import type {
  WorkbenchAttemptTranscriptReadResult,
  WorkbenchRunTask,
  WorkbenchRunTaskAttempt
} from '../../../src/shared/rpc-contract/workbench-task-window-params'
import {
  AGY_COMPLETED,
  CODEX_FAILED,
  CODEX_LIVE,
  CODEX_MALFORMED,
  CODEX_TRUNCATED
} from './scenario-workbench-transcripts'

// FIXTURE_ONLY task lists and transcript reads for the D-024 task window captures. The live attempt
// reveals one more line per read and never ends; nothing reads a runtime or a file.

export type TaskWindowFixtureReply =
  | { ok: true; result: unknown }
  | { ok: false; code: string; message: string }

/** Lines the live attempt shows before its first read; each later read adds one. */
const LIVE_INITIAL_LINES = 3
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function at(minute: number, second = 0): string {
  return new Date(Date.UTC(2026, 9, 3, 10, minute, second)).toISOString()
}

function attempt(
  dispatchId: string,
  state: string,
  startMinute: number,
  settledMinute: number | null
): WorkbenchRunTaskAttempt {
  return {
    dispatchId,
    state,
    startedAt: at(startMinute),
    settledAt: settledMinute === null ? null : at(settledMinute, 40),
    hasTranscript: true,
    worktree: null
  }
}

const TRANSCRIPTS: Readonly<Record<string, readonly string[]>> = {
  'fixture-attempt-a1': CODEX_FAILED,
  'fixture-attempt-a2': CODEX_LIVE,
  'fixture-attempt-b1': AGY_COMPLETED,
  'fixture-attempt-d1': CODEX_TRUNCATED,
  'fixture-attempt-e1': [],
  'fixture-attempt-f1': CODEX_MALFORMED
}
const LIVE_ATTEMPTS: ReadonlySet<string> = new Set(['fixture-attempt-a2'])

function runTasks(): WorkbenchRunTask[] {
  const task = (
    taskId: string,
    title: string,
    executorKind: string,
    attempts: WorkbenchRunTaskAttempt[]
  ) => ({
    taskId,
    title,
    executorKind,
    attempts
  })
  return [
    task('fixture-task-a', 'Review the receipt parser edge cases', 'codex', [
      attempt('fixture-attempt-a1', 'failed', 36, 37),
      attempt('fixture-attempt-a2', 'running', 44, null)
    ]),
    task('fixture-task-b', 'Summarize the failing receipt tests', 'agy', [
      attempt('fixture-attempt-b1', 'completed', 38, 39)
    ]),
    task('fixture-task-c', 'Draft the validator handoff notes', 'claude_subagent', [
      { ...attempt('fixture-dispatch-c1', 'running', 40, null), hasTranscript: false }
    ]),
    task('fixture-task-d', 'Add the missing signature guard', 'codex', [
      attempt('fixture-attempt-d1', 'completed', 30, 34)
    ]),
    task('fixture-task-e', 'List the contract owners', 'agy', [
      attempt('fixture-attempt-e1', 'completed', 41, 41)
    ]),
    task('fixture-task-f', 'Map the receipt schema', 'codex', [
      attempt('fixture-attempt-f1', 'completed', 33, 33)
    ]),
    task('fixture-task-g', 'Run the release checklist workflow', 'claude_workflow', [])
  ]
}

function numberField(params: unknown, key: string): number {
  if (typeof params !== 'object' || params === null) {
    return 0
  }
  const value = Object.entries(params).find(([name]) => name === key)?.[1]
  return typeof value === 'number' ? value : 0
}

function stringField(params: unknown, key: string): string {
  if (typeof params !== 'object' || params === null) {
    return ''
  }
  const value = Object.entries(params).find(([name]) => name === key)?.[1]
  return typeof value === 'string' ? value : ''
}

export function createTaskWindowFixture() {
  // Why mutable: the live attempt grows between reads, as a running CLI's transcript does.
  let liveLines = LIVE_INITIAL_LINES

  function read(params: unknown): TaskWindowFixtureReply {
    const dispatchId = stringField(params, 'dispatchId')
    const lines = TRANSCRIPTS[dispatchId]
    if (!lines) {
      return {
        ok: false,
        code: 'workbench_attempt_not_found',
        message: 'The attempt was not found.'
      }
    }
    const live = LIVE_ATTEMPTS.has(dispatchId)
    const shown = live ? lines.slice(0, Math.min(liveLines++, lines.length)) : lines
    const bytes = encoder.encode(shown.map((line) => `${line}\n`).join(''))
    const from = numberField(params, 'fromByteOffset')
    const last = shown.at(-1) ?? ''
    const result: WorkbenchAttemptTranscriptReadResult = {
      chunk: from > bytes.length ? '' : decoder.decode(bytes.subarray(from)),
      nextByteOffset: from > bytes.length ? 0 : bytes.length,
      fileIdentity: `fixture-${dispatchId}`,
      reset: from > bytes.length,
      truncated: shown.some((line) => line.includes('"code":"truncated"')),
      live,
      ended: last.includes('"kind":"end"')
    }
    return { ok: true, result }
  }

  return {
    tasks: (runId: string): TaskWindowFixtureReply => ({
      ok: true,
      result: { tasks: runId === 'fixture-run-006' ? runTasks() : [] }
    }),
    read
  }
}

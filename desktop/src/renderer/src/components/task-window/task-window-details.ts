import type { WorkbenchRunTaskAttempt } from '../../../../shared/rpc-contract/workbench-task-window-params'
import { errorDetails, type WorkbenchDetail } from '../right-sidebar/workbench-details'
import type { WorkbenchError } from '../right-sidebar/workbench-rpc-error'
import type { TranscriptRecord } from './task-window-records'
import type { OpenTaskWindowState } from './task-window-tab'
import type { TranscriptError } from './task-window-transcript-state'

type StartRecord = Extract<TranscriptRecord, { kind: 'start' }>
type EndRecord = Extract<TranscriptRecord, { kind: 'end' }>

/** The task window's "Copy details": attempt and task IDs, worktree, base commit and end codes. */
export function taskWindowDetails(input: {
  state: OpenTaskWindowState
  attempt: WorkbenchRunTaskAttempt | null
  start: StartRecord | null
  end: EndRecord | null
  attemptsError?: WorkbenchError | null
  transcriptError?: TranscriptError | null
}): WorkbenchDetail[] {
  const { state, attempt, start, end } = input
  const worktree = start?.worktree ?? attempt?.worktree ?? null
  return [
    ['run_id', state.runId],
    ['task_id', state.taskId],
    ['executor', state.executorKind],
    ['attempt_id', attempt?.dispatchId],
    ['attempt_state', end?.state ?? attempt?.state],
    ['model', start?.model],
    ['effort', start?.effort],
    ['sandbox', start?.sandbox],
    ['cwd', start?.cwd],
    ['branch', worktree?.branch],
    ['worktree_path', worktree?.path],
    ['base_commit', worktree?.baseCommit],
    ['started_at', start?.at ?? attempt?.startedAt],
    ['settled_at', end?.at ?? attempt?.settledAt],
    ['exit_code', end?.exitCode],
    ['end_reason', end?.reasonCode],
    ...errorDetails(input.attemptsError, 'attempts'),
    ...errorDetails(input.transcriptError, 'transcript')
  ]
}

import { translate } from '@/i18n/i18n'
import type { WorkbenchRunTaskAttempt } from '../../../../shared/rpc-contract/workbench-task-window-params'

/** Only the headless executors have a transcript; Claude tasks run in the visible session. */
export type TaskWindowExecutor = 'codex' | 'agy'

/** D-024: what a task window tab holds; the transcript itself is read from main, never stored here. */
export type OpenTaskWindowState = {
  readonly runId: string
  readonly taskId: string
  readonly title: string | null
  readonly executorKind: TaskWindowExecutor
  readonly attempts: readonly WorkbenchRunTaskAttempt[]
  readonly selectedDispatchId: string
}

export function isTaskWindowExecutor(kind: string): kind is TaskWindowExecutor {
  return kind === 'codex' || kind === 'agy'
}

// Why not localized: these are the CLIs' product names.
export function taskWindowExecutorName(kind: TaskWindowExecutor): string {
  return kind === 'codex' ? 'Codex' : 'agy'
}

export function taskWindowTitle(title: string | null): string {
  return title?.trim() || translate('workbench.taskWindow.untitledTask', 'Untitled task')
}

/** One tab per task; its attempts are chosen inside the tab. */
export function buildTaskWindowTabId(worktreeId: string, taskId: string): string {
  return `${worktreeId}::task-window::${taskId}`
}

export function getTaskWindowTabLabel(
  state: Pick<OpenTaskWindowState, 'executorKind' | 'title'>
): string {
  return `${taskWindowExecutorName(state.executorKind)} · ${taskWindowTitle(state.title)}`
}

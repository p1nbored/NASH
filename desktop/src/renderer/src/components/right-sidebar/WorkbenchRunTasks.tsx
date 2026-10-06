import { ScrollText, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { WorkbenchRunTask } from '../../../../shared/rpc-contract/workbench-task-window-params'
import type { WorkflowRunView } from '../../../../shared/workflow-run/workflow-run-view'
import {
  attemptStateLabel,
  elapsedBetween,
  taskExecutorLabel
} from '../task-window/task-window-copy'
import { isTaskWindowExecutor, taskWindowTitle } from '../task-window/task-window-tab'
import { useWorkbenchRunTasks } from './use-workbench-run-tasks'
import { findRunTerminalTabId, showRunTerminal } from './workbench-run-terminal'

function taskSummary(task: WorkbenchRunTask, readAt: number): string {
  const latest = task.attempts.at(-1) ?? null
  const elapsed = latest ? elapsedBetween(latest.startedAt, latest.settledAt, readAt) : null
  return [taskExecutorLabel(task.executorKind), attemptStateLabel(latest?.state ?? null), elapsed]
    .filter(Boolean)
    .join(' · ')
}

function isSessionTask(kind: string): boolean {
  return kind === 'claude_subagent' || kind === 'claude_workflow' || kind === 'claude_primary'
}

function TaskAction({
  run,
  task
}: {
  run: WorkflowRunView
  task: WorkbenchRunTask
}): React.JSX.Element | null {
  const tabId = useAppStore((state) =>
    findRunTerminalTabId(state.tabsByWorktree, run.workspaceId, run.primary?.paneKey ?? null)
  )
  const title = taskWindowTitle(task.title)
  const latest = task.attempts.at(-1)
  const kind = task.executorKind
  if (isTaskWindowExecutor(kind) && latest) {
    return (
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={translate('workbench.tasks.openWindowLabel', 'Open task window for {{title}}', {
          title
        })}
        onClick={() =>
          useAppStore.getState().openTaskWindow(run.workspaceId, {
            runId: run.runId,
            taskId: task.taskId,
            title: task.title,
            executorKind: kind,
            attempts: task.attempts,
            selectedDispatchId: latest.dispatchId
          })
        }
      >
        <ScrollText />
        {translate('workbench.tasks.openWindow', 'Open task window')}
      </Button>
    )
  }
  if (isSessionTask(kind) && tabId) {
    return (
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={translate('workbench.tasks.showTerminalLabel', 'Show terminal for {{title}}', {
          title
        })}
        onClick={() => showRunTerminal(tabId)}
      >
        <SquareTerminal />
        {translate('workbench.runs.showTerminal', 'Show terminal')}
      </Button>
    )
  }
  return null
}

/** D-024: the run's tasks under its details; Codex and agy attempts open a read-only task window. */
export default function WorkbenchRunTasks({
  run
}: {
  run: WorkflowRunView
}): React.JSX.Element | null {
  const { tasks, error, readAt } = useWorkbenchRunTasks(run)
  if (tasks === null && error === null) {
    return null
  }
  const heading = translate('workbench.tasks.title', 'Tasks')
  return (
    <section aria-label={heading} className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground">{heading}</h4>
      {error && (
        <p className="break-words text-xs text-muted-foreground">
          {translate('workbench.tasks.readFailed', 'Tasks could not be read: {{message}}', {
            message: error.message
          })}
        </p>
      )}
      {tasks?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {translate('workbench.tasks.empty', 'No tasks yet.')}
        </p>
      )}
      {tasks && tasks.length > 0 && (
        <ul aria-label={heading} className="divide-y divide-border">
          {tasks.map((task) => (
            <li key={task.taskId} className="space-y-1 py-1.5">
              <div className="flex min-w-0 items-start gap-2">
                <p className="min-w-0 flex-1 break-words text-[13px] text-foreground">
                  {taskWindowTitle(task.title)}
                </p>
                <TaskAction run={run} task={task} />
              </div>
              <p className="text-xs text-muted-foreground">{taskSummary(task, readAt)}</p>
              {isSessionTask(task.executorKind) && (
                <p className="text-xs text-muted-foreground">
                  {translate('workbench.tasks.inSession', 'Runs in the main session.')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

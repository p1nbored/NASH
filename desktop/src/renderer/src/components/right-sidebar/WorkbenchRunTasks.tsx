import { ScrollText, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { WorkbenchRunTask } from '../../../../shared/rpc-contract/workbench-task-window-params'
import type { WorkflowRunView } from '../../../../shared/workflow-run/workflow-run-view'
import {
  attemptStateKind,
  attemptStateLabel,
  elapsedBetween,
  taskExecutorLabel
} from '../task-window/task-window-copy'
import { isTaskWindowExecutor, taskWindowTitle } from '../task-window/task-window-tab'
import { useWorkbenchRunTasks } from './use-workbench-run-tasks'
import WorkbenchCallout from './WorkbenchCallout'
import { errorDetails } from './workbench-details'
import { findRunTerminalTabId, showRunTerminal } from './workbench-run-terminal'
import WorkbenchStateChip from './WorkbenchStateChip'

function taskSummary(task: WorkbenchRunTask, readAt: number): string {
  const latest = task.attempts.at(-1) ?? null
  const elapsed = latest ? elapsedBetween(latest.startedAt, latest.settledAt, readAt) : null
  return [taskExecutorLabel(task.executorKind), elapsed].filter(Boolean).join(' · ')
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
        variant="ghost"
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
  // Why the primary's terminal: Claude subagents and workflows run inside the main session (D-024).
  if (isSessionTask(kind) && tabId) {
    return (
      <Button
        type="button"
        variant="ghost"
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
    <section aria-label={heading} className="space-y-1 pt-0.5">
      <h4 className="text-meta font-medium text-muted-foreground">{heading}</h4>
      {error && (
        <WorkbenchCallout
          tone="error"
          label={translate('workbench.tasks.readFailed', 'Tasks could not be read: {{message}}', {
            message: error.message
          })}
          details={{
            subject: 'run tasks',
            entries: [['run_id', run.runId], ...errorDetails(error)]
          }}
        />
      )}
      {tasks?.length === 0 && (
        <p className="text-meta text-muted-foreground">
          {translate('workbench.tasks.empty', 'No tasks yet.')}
        </p>
      )}
      {tasks && tasks.length > 0 && (
        <ul aria-label={heading} className="space-y-1.5">
          {tasks.map((task) => {
            const state = task.attempts.at(-1)?.state ?? null
            return (
              <li key={task.taskId} className="flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="break-words text-body text-foreground">
                    {taskWindowTitle(task.title)}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted-foreground">
                    <WorkbenchStateChip
                      kind={attemptStateKind(state)}
                      label={attemptStateLabel(state)}
                    />
                    <span>{taskSummary(task, readAt)}</span>
                  </div>
                </div>
                <TaskAction run={run} task={task} />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

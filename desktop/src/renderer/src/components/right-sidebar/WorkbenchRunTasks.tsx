import { MessageSquare, SquareTerminal } from 'lucide-react'
import { useState } from 'react'
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
import { useWorkbenchRunTasks } from './use-workbench-run-tasks'
import WorkbenchCallout from './WorkbenchCallout'
import { errorDetails } from './workbench-details'
import { findRunTerminalTabId, showRunTerminal, showTaskSource } from './workbench-run-terminal'
import { toWorkbenchError, type WorkbenchError } from './workbench-rpc-error'
import WorkbenchStateChip from './WorkbenchStateChip'

function taskTitle(title: string | null): string {
  return title?.trim() || translate('workbench.tasks.untitledTask', 'Untitled task')
}

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
  const [openError, setOpenError] = useState<WorkbenchError | null>(null)
  const title = taskTitle(task.title)
  const latest = task.attempts.at(-1)
  const kind = task.executorKind
  const source = latest?.source
  if (source) {
    return (
      <div className="space-y-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={translate('workbench.tasks.openSessionLabel', 'Open session for {{title}}', {
            title
          })}
          onClick={() => {
            setOpenError(null)
            void showTaskSource(source).catch((error: unknown) =>
              setOpenError(toWorkbenchError(error))
            )
          }}
        >
          <MessageSquare />
          {translate('workbench.tasks.openSession', 'Open session')}
        </Button>
        {openError && (
          <WorkbenchCallout
            tone="error"
            label={openError.message}
            details={{ subject: 'open task session', entries: errorDetails(openError) }}
          />
        )}
      </div>
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

/** The run's tasks link to their existing native session or the primary session. */
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
                  <p className="break-words text-body text-foreground">{taskTitle(task.title)}</p>
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

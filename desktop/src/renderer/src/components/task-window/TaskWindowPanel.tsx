import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { EMPTY_TRANSCRIPT_ROW_LOG } from './task-window-row-log'
import type { OpenTaskWindowState } from './task-window-tab'
import TaskWindowBody from './TaskWindowBody'
import TaskWindowHeader from './TaskWindowHeader'
import { useAttemptTranscript } from './use-attempt-transcript'
import { useTaskWindowAttempts } from './use-task-window-attempts'

function TaskWindowView({
  fileId,
  state
}: {
  fileId: string
  state: OpenTaskWindowState
}): React.JSX.Element {
  const attemptsError = useTaskWindowAttempts(fileId, state)
  const selectAttempt = useAppStore((s) => s.selectTaskWindowAttempt)
  const attempt =
    state.attempts.find((entry) => entry.dispatchId === state.selectedDispatchId) ??
    state.attempts.at(-1) ??
    null
  const transcript = useAttemptTranscript(attempt?.dispatchId ?? null)
  const rows = transcript?.rows ?? EMPTY_TRANSCRIPT_ROW_LOG
  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-surface">
      <TaskWindowHeader
        state={state}
        attempt={attempt}
        start={rows.start}
        end={rows.end}
        live={transcript?.live ?? false}
        truncated={transcript?.truncated ?? false}
        attemptsError={attemptsError}
        onSelectAttempt={(dispatchId) => selectAttempt(fileId, dispatchId)}
      />
      <TaskWindowBody
        key={attempt?.dispatchId ?? 'none'}
        hasAttempt={attempt !== null}
        transcript={transcript}
        rows={rows}
      />
    </div>
  )
}

/** D-024: a Codex or agy task's read-only window, showing the selected attempt's transcript. */
export default function TaskWindowPanel({
  fileId,
  state
}: {
  fileId: string
  state: OpenTaskWindowState | null
}): React.JSX.Element {
  if (!state) {
    return (
      <div className="flex h-full items-center justify-center bg-editor-surface text-sm text-muted-foreground">
        {translate('workbench.taskWindow.unavailable', 'The task window details are unavailable.')}
      </div>
    )
  }
  return <TaskWindowView fileId={fileId} state={state} />
}

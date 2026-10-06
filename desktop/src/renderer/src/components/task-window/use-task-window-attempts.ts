import { useCallback, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { WorkbenchRunTasksResultSchema } from '../../../../shared/rpc-contract/workbench-task-window-params'
import { useWorkbenchPoll } from '../right-sidebar/use-workbench-poll'
import { toWorkbenchError, type WorkbenchError } from '../right-sidebar/workbench-rpc-error'
import type { OpenTaskWindowState } from './task-window-tab'

export const TASK_WINDOW_ATTEMPTS_POLL_MS = 5_000
const LOCAL = { kind: 'local' } as const

/** Re-reads the task on the Workbench cadence, so a retry appears in the attempt list. */
export function useTaskWindowAttempts(
  fileId: string,
  state: OpenTaskWindowState
): WorkbenchError | null {
  const patch = useAppStore((s) => s.patchTaskWindowAttempts)
  const [error, setError] = useState<WorkbenchError | null>(null)
  // Why: a read slower than the cadence must not overlap the next, or an older answer lands last.
  const inFlightRef = useRef(false)
  const { runId, taskId } = state
  const refresh = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) {
      return
    }
    inFlightRef.current = true
    try {
      const result = WorkbenchRunTasksResultSchema.parse(
        await callRuntimeRpc<unknown>(LOCAL, 'workbench.runs.tasks', { runId })
      )
      const task = result.tasks.find((entry) => entry.taskId === taskId)
      if (task) {
        patch(fileId, task.attempts)
      }
      setError(null)
    } catch (failure) {
      setError(
        toWorkbenchError(failure, {
          invalidResponse: translate(
            'workbench.tasks.invalidResponse',
            'The task list returned an invalid response.'
          ),
          failed: translate('workbench.tasks.failed', 'The task list could not be read.')
        })
      )
    } finally {
      inFlightRef.current = false
    }
  }, [fileId, patch, runId, taskId])
  useWorkbenchPoll(() => void refresh(), TASK_WINDOW_ATTEMPTS_POLL_MS, true)
  return error
}

import { useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  WorkbenchRunTasksResultSchema,
  type WorkbenchRunTask
} from '../../../../shared/rpc-contract/workbench-task-window-params'
import type { WorkflowRunView } from '../../../../shared/workflow-run/workflow-run-view'
import { isRunEnded } from './use-workbench-runs'
import { toWorkbenchError, type WorkbenchError } from './workbench-rpc-error'

const LOCAL = { kind: 'local' } as const

export type WorkbenchRunTasksState = {
  readonly runId: string
  readonly tasks: readonly WorkbenchRunTask[] | null
  readonly error: WorkbenchError | null
  /** When the list was read; elapsed times are measured to it, so render stays pure. */
  readonly readAt: number
}

/**
 * D-024: a run's tasks, read again whenever the Workbench poll replaces the run's view. An ended
 * run's tasks no longer change, so it is read once more after it ends and then left alone.
 */
export function useWorkbenchRunTasks(run: WorkflowRunView): WorkbenchRunTasksState {
  const { runId } = run
  const [state, setState] = useState<WorkbenchRunTasksState>(() => ({
    runId,
    tasks: null,
    error: null,
    readAt: 0
  }))
  const sequence = useRef(0)
  const applied = useRef(0)
  const refreshKey = isRunEnded(run) ? 'ended' : run
  useEffect(() => {
    let mounted = true
    const read = ++sequence.current
    // Why a sequence: a slow read may finish after a newer one; only newer answers are kept.
    const accept = (next: WorkbenchRunTasksState): void => {
      if (mounted && read > applied.current) {
        applied.current = read
        setState(next)
      }
    }
    void (async () => {
      try {
        const result = WorkbenchRunTasksResultSchema.parse(
          await callRuntimeRpc<unknown>(LOCAL, 'workbench.runs.tasks', { runId })
        )
        accept({ runId, tasks: result.tasks, error: null, readAt: Date.now() })
      } catch (error) {
        accept({
          runId,
          tasks: null,
          readAt: Date.now(),
          error: toWorkbenchError(error, {
            invalidResponse: translate(
              'workbench.tasks.invalidResponse',
              'The task list returned an invalid response.'
            ),
            failed: translate('workbench.tasks.failed', 'The task list could not be read.')
          })
        })
      }
    })()
    return () => {
      mounted = false
    }
  }, [runId, refreshKey])
  return state.runId === runId ? state : { runId, tasks: null, error: null, readAt: 0 }
}

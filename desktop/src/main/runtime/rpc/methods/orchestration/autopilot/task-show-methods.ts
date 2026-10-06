import {
  TaskShowParams,
  type TaskShowInput
} from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import type {
  AutopilotAttemptResult,
  AutopilotTaskView,
  TaskShowResult
} from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { AttemptResultView } from '../../../../task-execution/executor-result-view'
import { defineMethod } from '../../../core'
import { resolveAutopilotPrimaryCaller } from './autopilot-primary-caller'
import { requireAutopilotTaskApi, type AutopilotTaskApi } from './autopilot-task-api'
import {
  readAutopilotTaskView,
  requireTaskOfRun,
  taskViewReaderFor
} from './autopilot-task-snapshot'

/** How often a wait re-reads the stores; a wait never outlasts its own `waitMs` (at most 20 s). */
const POLL_INTERVAL_MS = 500

function untrusted(view: AttemptResultView): AutopilotAttemptResult {
  if (view.state !== 'ok') {
    return { state: view.state, untrusted: true }
  }
  return {
    state: 'ok',
    text: view.text,
    truncated: view.truncated,
    secretsMasked: view.secretLike,
    bytes: view.bytes,
    sha256: view.sha256,
    untrusted: true
  }
}

async function waitForChange(
  api: AutopilotTaskApi,
  read: () => AutopilotTaskView,
  waitMs: number,
  signal: AbortSignal | undefined
): Promise<AutopilotTaskView> {
  const deadline = api.now() + waitMs
  let view = read()
  while (view.waitable && !signal?.aborted) {
    const remaining = deadline - api.now()
    if (remaining <= 0) {
      break
    }
    await api.sleep(Math.min(POLL_INTERVAL_MS, remaining), signal)
    view = read()
  }
  return view
}

async function showTask(
  api: AutopilotTaskApi,
  owner: OrchestrationDb,
  runId: string,
  params: TaskShowInput,
  signal: AbortSignal | undefined
): Promise<TaskShowResult> {
  const reader = taskViewReaderFor(api, owner)
  const read = () => readAutopilotTaskView(reader, requireTaskOfRun(owner, params.taskId, runId))
  const task = await waitForChange(api, read, params.waitMs ?? 0, signal)
  // Why only process attempts: an in-session attempt's work is the primary's own, never an app file.
  const result =
    task.attempt?.runsIn === 'process'
      ? untrusted(await api.readAttemptResult(task.attempt.attemptId))
      : null
  return { task, result }
}

/**
 * `task-show`: the attested primary reads one of its tasks, optionally waiting (one slice of at most
 * 20 s; the CLI loops) while only the app can move it. An executor's output appears only as the
 * bounded, masked result view, marked untrusted.
 */
export const TASK_SHOW_METHOD = defineMethod({
  name: 'orchestration.taskShow',
  params: TaskShowParams,
  handler: (params, context): Promise<TaskShowResult> => {
    const api = requireAutopilotTaskApi(context.runtime)
    const caller = resolveAutopilotPrimaryCaller(context.runtime, context, {
      requireActiveRun: false
    })
    const owner = context.runtime.getOrchestrationDb()
    return showTask(api, owner, caller.runId, params, context.signal)
  }
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchRunTasksParams } from '../../../../shared/rpc-contract/workbench-task-window-params'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import {
  createTaskWindowHarness,
  seedNativeAttempt,
  type TaskWindowHarness
} from '../../workbench-task-window/task-window.test-fixture'
import { RpcDispatcher } from '../dispatcher'
import { WORKBENCH_RUN_TASKS_METHOD, WORKBENCH_TASK_WINDOW_METHODS } from './workbench-task-window'
let harness: TaskWindowHarness
beforeEach(() => {
  harness = createTaskWindowHarness()
})
afterEach(() => harness.close())
function dispatcherFor() {
  const runtime = {
    getRuntimeId: vi.fn(() => 'fixture-runtime'),
    getOrchestrationDb: vi.fn(() => harness.owner)
  }
  const dispatcher = new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only these two runtime members are read by the task-list method.
    runtime: runtime as never,
    methods: WORKBENCH_TASK_WINDOW_METHODS
  })
  return { runtime, dispatcher }
}
function call(dispatcher: RpcDispatcher, method: string, params: unknown, trusted = true) {
  return dispatcher.dispatch(
    { id: 'fixture-request', authToken: 'fixture-local-token', method, params },
    trusted ? { workbenchCaller: issueWorkbenchDesktopCaller() } : {}
  )
}
describe('task list methods', () => {
  it('binds the shared schema and removes the retired transcript method', async () => {
    expect(WORKBENCH_RUN_TASKS_METHOD.params).toBe(WorkbenchRunTasksParams)
    const { dispatcher } = dispatcherFor()
    expect(await call(dispatcher, 'workbench.attempts.transcript.read', {})).toMatchObject({
      ok: false,
      error: { code: 'method_not_found' }
    })
  })
  it('refuses an untrusted caller before reading the database', async () => {
    const { dispatcher, runtime } = dispatcherFor()
    expect(
      await call(dispatcher, 'workbench.runs.tasks', { runId: harness.runId }, false)
    ).toMatchObject({ ok: false, error: { code: 'workbench_forbidden' } })
    expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
  })
  it('serves current native attempts to the desktop without reading output files', async () => {
    const { dispatchId } = seedNativeAttempt(harness, {
      title: 'Review the parser',
      terminal: 'terminal-fixture'
    })
    const { dispatcher, runtime } = dispatcherFor()
    expect(await call(dispatcher, 'workbench.runs.tasks', { runId: harness.runId })).toMatchObject({
      ok: true,
      result: {
        tasks: [
          {
            title: 'Review the parser',
            attempts: [{ dispatchId, source: { kind: 'terminal', terminal: 'terminal-fixture' } }]
          }
        ]
      }
    })
    expect(runtime.getOrchestrationDb).toHaveBeenCalledWith({ passive: true })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAppEnvironment,
  hasAppEnvironment,
  setAppEnvironment,
  type AppEnvironment
} from '../../../../shared/app-environment'
import {
  WorkbenchAttemptTranscriptReadParams,
  WorkbenchRunTasksParams
} from '../../../../shared/rpc-contract/workbench-task-window-params'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import {
  FIXTURE_START,
  createTaskWindowHarness,
  seedCodexAttempt,
  writeTranscript,
  type TaskWindowHarness
} from '../../workbench-task-window/task-window.test-fixture'
import { RpcDispatcher } from '../dispatcher'
import {
  WORKBENCH_ATTEMPT_TRANSCRIPT_READ_METHOD,
  WORKBENCH_RUN_TASKS_METHOD,
  WORKBENCH_TASK_WINDOW_METHODS
} from './workbench-task-window'

let harness: TaskWindowHarness | null = null
let previous: AppEnvironment | null = null

function environment(userData: string): AppEnvironment {
  return {
    getPath: () => userData,
    getAppPath: () => userData,
    getVersion: () => '0.0.0-test',
    isPackaged: () => false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  }
}

beforeEach(() => {
  harness = createTaskWindowHarness()
  previous = hasAppEnvironment() ? getAppEnvironment() : null
  setAppEnvironment(environment(harness.userDataPath))
})

afterEach(() => {
  if (previous) {
    setAppEnvironment(previous)
  }
  harness?.close()
  harness = null
})

function dispatcherFor(h: TaskWindowHarness) {
  const runtime = {
    getRuntimeId: vi.fn(() => 'fixture-runtime'),
    getOrchestrationDb: vi.fn(() => h.owner)
  }
  const dispatcher = new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the task window methods run, and they read these two members.
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

describe('task window methods', () => {
  it('bind the shared params schemas, so the catalog and the dispatcher agree', () => {
    expect(WORKBENCH_RUN_TASKS_METHOD.name).toBe('workbench.runs.tasks')
    expect(WORKBENCH_RUN_TASKS_METHOD.params).toBe(WorkbenchRunTasksParams)
    expect(WORKBENCH_ATTEMPT_TRANSCRIPT_READ_METHOD.name).toBe('workbench.attempts.transcript.read')
    expect(WORKBENCH_ATTEMPT_TRANSCRIPT_READ_METHOD.params).toBe(
      WorkbenchAttemptTranscriptReadParams
    )
  })

  it('refuse a caller that is not the desktop renderer before reading the database', async () => {
    const h = harness
    if (!h) {
      throw new Error('harness')
    }
    const { dispatcher, runtime } = dispatcherFor(h)
    const { dispatchId } = seedCodexAttempt(h)
    for (const [method, params] of [
      ['workbench.runs.tasks', { runId: h.runId }],
      ['workbench.attempts.transcript.read', { dispatchId, fromByteOffset: 0, maxBytes: 1024 }]
    ] as const) {
      expect(await call(dispatcher, method, params, false)).toMatchObject({
        ok: false,
        error: { code: 'workbench_forbidden' }
      })
    }
    expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
  })

  it('serve the desktop the task list and a transcript chunk, with no path in either answer', async () => {
    const h = harness
    if (!h) {
      throw new Error('harness')
    }
    const { dispatcher, runtime } = dispatcherFor(h)
    const { dispatchId, runDir } = seedCodexAttempt(h, { title: 'Review the parser' })
    writeTranscript(runDir, FIXTURE_START)

    const tasks = await call(dispatcher, 'workbench.runs.tasks', { runId: h.runId })
    expect(tasks).toMatchObject({
      ok: true,
      result: {
        tasks: [
          {
            title: 'Review the parser',
            executorKind: 'codex',
            attempts: [{ dispatchId, hasTranscript: true }]
          }
        ]
      }
    })
    const read = await call(dispatcher, 'workbench.attempts.transcript.read', {
      dispatchId,
      fromByteOffset: 0,
      maxBytes: 1024
    })
    expect(read).toMatchObject({ ok: true, result: { chunk: FIXTURE_START, live: true } })
    expect(runtime.getOrchestrationDb).toHaveBeenCalledWith({ passive: true })
    const answers = JSON.stringify([tasks, read])
    expect(answers).not.toContain(h.userDataPath.replaceAll('\\', '\\\\'))
    expect(answers).not.toContain('autopilot-runs')
  })

  it('reject a read above 256 KiB and an unknown attempt with typed codes', async () => {
    const h = harness
    if (!h) {
      throw new Error('harness')
    }
    const { dispatcher } = dispatcherFor(h)
    const tooBig = await call(dispatcher, 'workbench.attempts.transcript.read', {
      dispatchId: 'ctx_000000000000',
      fromByteOffset: 0,
      maxBytes: 262_145
    })
    expect(tooBig).toMatchObject({ ok: false })
    expect(
      await call(dispatcher, 'workbench.attempts.transcript.read', {
        dispatchId: 'ctx_000000000000',
        fromByteOffset: 0,
        maxBytes: 1024
      })
    ).toMatchObject({ ok: false, error: { code: 'workbench_attempt_not_found' } })
  })
})

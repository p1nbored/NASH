import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKBENCH_VALIDATION_ERROR_CODES,
  WorkbenchValidationCheckPendingParams
} from '../../../../shared/rpc-contract/workbench-validation-params'
import {
  registerValidationBacklogPort,
  validationPassRunning,
  type ValidationBacklogPort
} from '../../task-validation/validation-backlog-port'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import { RpcDispatcher } from '../dispatcher'
import {
  WORKBENCH_VALIDATION_CHECK_PENDING_METHOD,
  WORKBENCH_VALIDATION_METHODS
} from './workbench-validation'

const METHOD = 'workbench.validation.checkPending'
const COUNTS = { checked: 3, passed: 1, failed: 1, inconclusive: 0, skipped: 1 }
const unregisters: (() => void)[] = []

afterEach(() => {
  for (const unregister of unregisters.splice(0)) {
    unregister()
  }
})

function harness(port?: ValidationBacklogPort) {
  const runtime = { getRuntimeId: vi.fn(() => 'fixture-runtime') }
  if (port) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the registry only uses the runtime as a WeakMap key.
    unregisters.push(registerValidationBacklogPort(runtime as never, port))
  }
  const dispatcher = new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the validation method reads no runtime member besides the registry key.
    runtime: runtime as never,
    methods: WORKBENCH_VALIDATION_METHODS
  })
  return (trusted: boolean, params: unknown = {}) =>
    dispatcher.dispatch(
      { id: 'fixture-request', authToken: 'fixture-local-token', method: METHOD, params },
      trusted ? { workbenchCaller: issueWorkbenchDesktopCaller() } : {}
    )
}

describe('workbench.validation.checkPending', () => {
  it('binds the shared params schema, so the catalog and the dispatcher agree', () => {
    expect(WORKBENCH_VALIDATION_CHECK_PENDING_METHOD.name).toBe(METHOD)
    expect(WORKBENCH_VALIDATION_CHECK_PENDING_METHOD.params).toBe(
      WorkbenchValidationCheckPendingParams
    )
    expect(WORKBENCH_VALIDATION_METHODS).toContain(WORKBENCH_VALIDATION_CHECK_PENDING_METHOD)
  })

  it('refuses a caller that is not the desktop renderer before any pass starts', async () => {
    const port = { checkBacklog: vi.fn(async () => COUNTS) }
    const call = harness(port)
    expect(await call(false)).toMatchObject({
      ok: false,
      error: { code: 'workbench_forbidden' }
    })
    expect(port.checkBacklog).not.toHaveBeenCalled()
  })

  it('runs one pass for the desktop and answers its counts by outcome', async () => {
    const port = { checkBacklog: vi.fn(async () => COUNTS) }
    const call = harness(port)
    expect(await call(true)).toMatchObject({ ok: true, result: COUNTS })
    expect(port.checkBacklog).toHaveBeenCalledTimes(1)
  })

  it('refuses params that try to steer the pass', async () => {
    const port = { checkBacklog: vi.fn(async () => COUNTS) }
    const call = harness(port)
    expect(await call(true, { limit: 1000 })).toMatchObject({ ok: false })
    expect(port.checkBacklog).not.toHaveBeenCalled()
  })

  it('refuses with the unavailable code when validation is not installed', async () => {
    expect(await harness()(true)).toMatchObject({
      ok: false,
      error: { code: WORKBENCH_VALIDATION_ERROR_CODES.unavailable }
    })
  })

  it('passes a pass-running refusal through with its code', async () => {
    const call = harness({
      checkBacklog: vi.fn(async () => {
        throw validationPassRunning()
      })
    })
    expect(await call(true)).toMatchObject({
      ok: false,
      error: {
        code: WORKBENCH_VALIDATION_ERROR_CODES.passRunning,
        message: 'A validation pass is already running. Check again when it finishes.'
      }
    })
  })
})

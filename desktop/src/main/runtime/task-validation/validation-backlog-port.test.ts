import { describe, expect, it, vi } from 'vitest'
import { WORKBENCH_VALIDATION_ERROR_CODES } from '../../../shared/rpc-contract/workbench-validation-params'
import type { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  registerValidationBacklogPort,
  requireValidationBacklogPort,
  summarizeValidationPass,
  type ValidationBacklogPort
} from './validation-backlog-port'
import type { ValidationRunReport } from './validation-runner'

// FIXTURE_ONLY: a runtime is only a registry key here.
function runtimeKey(): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the registry only uses the object as a WeakMap key.
  return {} as OrcaRuntimeService
}

function port(): ValidationBacklogPort {
  return {
    checkBacklog: vi.fn(async () => ({
      checked: 0,
      passed: 0,
      failed: 0,
      inconclusive: 0,
      skipped: 0
    }))
  }
}

function refusalCode(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : 'not_an_orchestration_error'
  }
}

describe('summarizeValidationPass', () => {
  it('counts each attempt once, by its verdict or as skipped', () => {
    const reports: ValidationRunReport[] = [
      { dispatchId: 'ctx_a', outcome: 'settled', verdict: 'pass', validationId: 'val_a' },
      { dispatchId: 'ctx_b', outcome: 'settled', verdict: 'pass', validationId: 'val_b' },
      { dispatchId: 'ctx_c', outcome: 'settled', verdict: 'fail', validationId: 'val_c' },
      { dispatchId: 'ctx_d', outcome: 'settled', verdict: 'inconclusive', validationId: 'val_d' },
      { dispatchId: 'ctx_e', outcome: 'skipped', reason: 'in_flight' },
      { dispatchId: 'ctx_f', outcome: 'skipped', reason: 'attempt_unreadable' }
    ]
    expect(summarizeValidationPass(reports)).toEqual({
      checked: 6,
      passed: 2,
      failed: 1,
      inconclusive: 1,
      skipped: 2
    })
  })

  it('answers zeros for an empty backlog', () => {
    expect(summarizeValidationPass([])).toEqual({
      checked: 0,
      passed: 0,
      failed: 0,
      inconclusive: 0,
      skipped: 0
    })
  })
})

describe('the validation backlog port registry', () => {
  it('refuses with the unavailable code until startup registers a port', () => {
    const runtime = runtimeKey()
    expect(refusalCode(() => requireValidationBacklogPort(runtime))).toBe(
      WORKBENCH_VALIDATION_ERROR_CODES.unavailable
    )
  })

  it('serves the registered port for its runtime only, until it is unregistered', () => {
    const runtime = runtimeKey()
    const other = runtimeKey()
    const registered = port()
    const unregister = registerValidationBacklogPort(runtime, registered)
    expect(requireValidationBacklogPort(runtime)).toBe(registered)
    expect(refusalCode(() => requireValidationBacklogPort(other))).toBe(
      WORKBENCH_VALIDATION_ERROR_CODES.unavailable
    )
    unregister()
    expect(refusalCode(() => requireValidationBacklogPort(runtime))).toBe(
      WORKBENCH_VALIDATION_ERROR_CODES.unavailable
    )
  })

  it('treats a second port for one runtime as a wiring bug, and a stale unregister as a no-op', () => {
    const runtime = runtimeKey()
    const first = port()
    const unregisterFirst = registerValidationBacklogPort(runtime, first)
    expect(() => registerValidationBacklogPort(runtime, port())).toThrow(/already registered/)
    unregisterFirst()
    const second = port()
    registerValidationBacklogPort(runtime, second)
    unregisterFirst()
    expect(requireValidationBacklogPort(runtime)).toBe(second)
  })
})

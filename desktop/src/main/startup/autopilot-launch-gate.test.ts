import { describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import type { PrimarySessionRuntime } from '../runtime/workflow-run/primary-session-runtime'
import { createLaunchGate } from './autopilot-launch-gate'

function primary() {
  const runtime = {
    startWorkflowRun: vi.fn(async () => ({ fixture: 'started' })),
    stopPrimarySession: vi.fn(async () => ({ fixture: 'stopped' })),
    readPrimarySessionStatus: vi.fn(async () => null)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the gate reads only the members defined here.
  return { runtime, typed: runtime as unknown as PrimarySessionRuntime }
}

async function codeOf(run: Promise<unknown>): Promise<string | null> {
  try {
    await run
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : 'not_an_orchestration_error'
  }
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake start ignores its input.
const INPUT = {} as never

describe('createLaunchGate', () => {
  it('refuses a launch while closed, before the runtime is called', async () => {
    const { runtime, typed } = primary()
    const gate = createLaunchGate(typed)
    expect(gate.isOpen()).toBe(false)
    expect(await codeOf(gate.runtime.startWorkflowRun(INPUT))).toBe(
      'autopilot_primary_session_not_configured'
    )
    expect(runtime.startWorkflowRun).not.toHaveBeenCalled()
  })

  it('passes launches through once open, and refuses again once closed', async () => {
    const { runtime, typed } = primary()
    const gate = createLaunchGate(typed)
    gate.open()
    expect(await gate.runtime.startWorkflowRun(INPUT)).toEqual({ fixture: 'started' })
    gate.close()
    expect(await codeOf(gate.runtime.startWorkflowRun(INPUT))).toBe(
      'autopilot_primary_session_not_configured'
    )
    expect(runtime.startWorkflowRun).toHaveBeenCalledTimes(1)
  })

  it('keeps status and stop working while closed', async () => {
    const { runtime, typed } = primary()
    const gate = createLaunchGate(typed)
    await gate.runtime.stopPrimarySession('run_fixture', 'user_stopped')
    expect(runtime.stopPrimarySession).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { WORKBENCH_VALIDATION_ERROR_CODES } from '../../shared/rpc-contract/workbench-validation-params'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { setTaskClassificationRuntime } from '../runtime/task-classification/classification-runtime'
import { requireValidationBacklogPort } from '../runtime/task-validation/validation-backlog-port'
import { setWorkbenchRoutingRuntime } from '../runtime/workbench-routing/workbench-routing-runtime'
import { setPrimarySessionRuntime } from '../runtime/workflow-run/primary-session-runtime'
import { fakeInstallPorts } from './autopilot-install-ports.test-fixture'
import {
  installAutopilotRuntime,
  type AutopilotRuntimeInstallation
} from './autopilot-runtime-install'
import { createFakeAutopilot, type FakeAutopilotOptions } from './autopilot-runtime.test-fixture'

// The desktop's "Check now" reaches the validation queue through a port the install registers.

let installation: AutopilotRuntimeInstallation | null = null

afterEach(async () => {
  await installation?.shutdown()
  installation = null
  setTaskClassificationRuntime(null)
  setPrimarySessionRuntime(null)
  setWorkbenchRoutingRuntime(null)
})

async function install(options: FakeAutopilotOptions = {}) {
  const fake = createFakeAutopilot(options)
  installation = await installAutopilotRuntime(fakeInstallPorts(fake), fake.builders)
  return { fake, installation }
}

function portRefusal(runtime: OrcaRuntimeService): string | null {
  try {
    requireValidationBacklogPort(runtime)
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : 'not_an_orchestration_error'
  }
}

describe('the validation backlog port at install', () => {
  it('is registered with validation and runs one pass through the validation runner', async () => {
    const { fake } = await install()
    await expect(requireValidationBacklogPort(fake.runtime).checkBacklog()).resolves.toEqual({
      checked: 0,
      passed: 0,
      failed: 0,
      inconclusive: 0,
      skipped: 0
    })
    expect(fake.validation.validatePending).toHaveBeenCalledTimes(1)
  })

  it('stays unregistered when validation fails to install, so the check refuses', async () => {
    const { fake } = await install({ fail: 'createValidation' })
    expect(portRefusal(fake.runtime)).toBe(WORKBENCH_VALIDATION_ERROR_CODES.unavailable)
  })

  it('is unregistered at will-quit', async () => {
    const { fake, installation: installed } = await install()
    await installed.shutdown()
    expect(portRefusal(fake.runtime)).toBe(WORKBENCH_VALIDATION_ERROR_CODES.unavailable)
  })
})

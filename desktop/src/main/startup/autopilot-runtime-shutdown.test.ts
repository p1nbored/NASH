import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { requirePermissionRelay } from '../runtime/permission-relay/permission-relay-registry'
import { requireAutopilotTaskApi } from '../runtime/rpc/methods/orchestration/autopilot/autopilot-task-api'
import {
  getTaskClassificationRuntime,
  setTaskClassificationRuntime
} from '../runtime/task-classification/classification-runtime'
import {
  requireRoutingTableContext,
  routingTableAvailabilityOf
} from '../runtime/workbench-run/routing-table-context-registry'
import {
  requireWorkbenchRoutingRuntime,
  setWorkbenchRoutingRuntime
} from '../runtime/workbench-routing/workbench-routing-runtime'
import { registerExecutorStopPort } from '../runtime/workflow-run/executor-stop-port'
import {
  getPrimarySessionRuntime,
  requirePrimarySessionRuntime,
  setPrimarySessionRuntime
} from '../runtime/workflow-run/primary-session-runtime'
import { installAutopilotRuntime } from './autopilot-runtime-install'
import { fakeInstallPorts } from './autopilot-install-ports.test-fixture'
import { createFakeAutopilot, launchOutcome } from './autopilot-runtime.test-fixture'

afterEach(() => {
  setTaskClassificationRuntime(null)
  setPrimarySessionRuntime(null)
  setWorkbenchRoutingRuntime(null)
})

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : 'not_an_orchestration_error'
  }
}

async function installed(options: { quitWaitMs?: number } = {}) {
  const fake = createFakeAutopilot({ holdQuit: true })
  const ports = { ...fakeInstallPorts(fake), ...options }
  const installation = await installAutopilotRuntime(ports, fake.builders)
  fake.calls.length = 0
  return { fake, ports, installation }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('will-quit: fence, then wait for the runs to settle, then dispose', () => {
  it('fences new work at once: no launch, no task command, no classification', async () => {
    const { fake, installation } = await installed()
    const stopping = installation.shutdown()
    await flush()

    expect(fake.calls.slice(0, 5)).toEqual([
      'dotRemote.stop',
      'classifier.abortAll',
      'execution.abortAllForQuit',
      'clef.abortAllRouting',
      'settleLaunches'
    ])
    expect(codeOf(() => requireAutopilotTaskApi(fake.runtime))).toBe(
      'autopilot_task_api_unavailable'
    )
    expect(getTaskClassificationRuntime()).toBeNull()
    expect(await launchOutcome()).toEqual({
      ok: false,
      code: 'autopilot_primary_session_not_configured'
    })
    fake.release.executors()
    fake.release.launches()
    fake.release.validation()
    await stopping
  })

  it('keeps the primary runtime (and the database) until the executors and launches settled', async () => {
    const { fake, installation } = await installed()
    const stopping = installation.shutdown()
    await flush()
    expect(fake.calls).not.toContain('primary.dispose')
    expect(getPrimarySessionRuntime()).not.toBeNull()

    fake.release.executors()
    await flush()
    expect(fake.calls).not.toContain('primary.dispose')

    fake.release.launches()
    const report = await stopping
    expect(report.pending).toEqual([])
    const order = fake.calls
    expect(order.indexOf('execution.settled')).toBeLessThan(order.indexOf('primary.dispose'))
    expect(order.indexOf('launches.settled')).toBeLessThan(order.indexOf('primary.dispose'))
    expect(order.slice(order.indexOf('primary.dispose'))).toEqual([
      'primary.dispose',
      'relay.uninstall',
      'clef.uninstall'
    ])
  })

  it('aborts a validation still running, and waits for it to stop', async () => {
    const { fake, installation } = await installed()
    requireAutopilotTaskApi(fake.runtime).afterClaim({
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'ctx_running'
    })
    await vi.waitFor(() =>
      expect(fake.validation.validateAttempt).toHaveBeenCalledWith('ctx_running', expect.anything())
    )
    const signal = vi.mocked(fake.validation.validateAttempt).mock.calls[0]?.[1]
    fake.release.executors()
    fake.release.launches()
    const report = await installation.shutdown()
    expect(signal?.aborted).toBe(true)
    expect(report.pending).toEqual([])
  })

  it('unregisters everything it installed', async () => {
    const { fake, installation } = await installed()
    fake.release.executors()
    fake.release.launches()
    fake.release.validation()
    await installation.shutdown()

    expect(codeOf(() => requirePrimarySessionRuntime())).toBe(
      'autopilot_primary_session_not_configured'
    )
    expect(codeOf(() => requireAutopilotTaskApi(fake.runtime))).toBe(
      'autopilot_task_api_unavailable'
    )
    expect(codeOf(() => requirePermissionRelay(fake.runtime))).toBe(
      'autopilot_permission_relay_unavailable'
    )
    expect(codeOf(() => requireRoutingTableContext(fake.runtime))).toBe(
      'workbench_routing_table_unavailable'
    )
    expect(routingTableAvailabilityOf(fake.runtime)).toBeNull()
    expect(codeOf(() => requireWorkbenchRoutingRuntime())).toBe('workbench_routing_not_configured')
    expect(getTaskClassificationRuntime()).toBeNull()
    const unregister = registerExecutorStopPort(fake.runtime, { stopExecutor: vi.fn() })
    unregister()
    // The dot interface switch now reads off, so a server that syncs again closes the endpoint.
    const reader = vi.mocked(fake.runtime.installDotIngressEnabledReader).mock.calls.at(-1)?.[0]
    expect(reader?.()).toBe(false)
  })

  it('bounds the wait, reports what did not settle, and still disposes', async () => {
    const { fake, installation } = await installed({ quitWaitMs: 20 })
    const report = await installation.shutdown()
    expect([...report.pending].sort()).toEqual(['executors', 'launches'])
    expect(fake.calls).toContain('primary.dispose')
    expect(codeOf(() => requirePrimarySessionRuntime())).toBe(
      'autopilot_primary_session_not_configured'
    )
    fake.release.executors()
    fake.release.launches()
  })

  it('stops remote polling first and waits, bounded, for its last outbox flush', async () => {
    const fake = createFakeAutopilot({ holdRemote: true })
    const installation = await installAutopilotRuntime(
      { ...fakeInstallPorts(fake), quitWaitMs: 20 },
      fake.builders
    )
    fake.calls.length = 0
    const report = await installation.shutdown()
    expect(fake.calls[0]).toBe('dotRemote.stop')
    expect(report.pending).toEqual(['dotRemote'])
    expect(fake.calls).toContain('dotRemote.uninstall')
    expect(fake.calls.indexOf('dotRemote.uninstall')).toBeLessThan(
      fake.calls.indexOf('primary.dispose')
    )
    fake.release.remote()
  })

  it('runs once: a second call is a no-op', async () => {
    const { fake, installation } = await installed()
    fake.release.executors()
    fake.release.launches()
    fake.release.validation()
    await installation.shutdown()
    const calls = fake.calls.length
    const again = await installation.shutdown()
    expect(again.pending).toEqual([])
    expect(fake.calls).toHaveLength(calls)
  })
})

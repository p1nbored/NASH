import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerAutopilotTaskApi,
  requireAutopilotTaskApi
} from '../runtime/rpc/methods/orchestration/autopilot/autopilot-task-api'
import { requirePermissionRelay } from '../runtime/permission-relay/permission-relay-registry'
import {
  getTaskClassificationRuntime,
  setTaskClassificationRuntime
} from '../runtime/task-classification/classification-runtime'
import { isWorkbenchLaunchInFlight } from '../runtime/workbench-intake-launch'
import {
  requireRoutingTableContext,
  routingTableAvailabilityOf
} from '../runtime/workbench-run/routing-table-context-registry'
import { setWorkbenchRoutingRuntime } from '../runtime/workbench-routing/workbench-routing-runtime'
import { registerExecutorStopPort } from '../runtime/workflow-run/executor-stop-port'
import {
  getPrimarySessionRuntime,
  setPrimarySessionRuntime
} from '../runtime/workflow-run/primary-session-runtime'
import type { DotIntakeDoor } from '../runtime/dot-ingress/dot-ingress-ports'
import {
  AUTOPILOT_INSTALL_STEP_NAMES,
  installAutopilotRuntime,
  type AutopilotRuntimeInstallation
} from './autopilot-runtime-install'
import { fakeInstallPorts } from './autopilot-install-ports.test-fixture'
import { createFakeAutopilot } from './autopilot-runtime.test-fixture'

let installation: AutopilotRuntimeInstallation | null = null

afterEach(async () => {
  await installation?.shutdown()
  installation = null
  setTaskClassificationRuntime(null)
  setPrimarySessionRuntime(null)
  setWorkbenchRoutingRuntime(null)
})

// Why a guard: the fake records what it saw as unknown, so the door is checked rather than cast.
function isIntakeDoor(value: unknown): value is DotIntakeDoor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'submit' in value &&
    typeof value.submit === 'function' &&
    'cancel' in value &&
    typeof value.cancel === 'function'
  )
}

async function install(fake = createFakeAutopilot()) {
  const ports = fakeInstallPorts(fake)
  installation = await installAutopilotRuntime(ports, fake.builders)
  return { fake, ports, installation }
}

describe('installAutopilotRuntime: the tested startup order', () => {
  it('installs every step, in the documented order', async () => {
    const { installation: installed } = await install()
    expect(installed.report.steps.map((step) => step.name)).toEqual([
      ...AUTOPILOT_INSTALL_STEP_NAMES
    ])
    expect(installed.report.steps.every((step) => step.status === 'installed')).toBe(true)
    expect(AUTOPILOT_INSTALL_STEP_NAMES).toEqual([
      'workbenchSchema',
      'autopilotSchema',
      'dotSchema',
      'clefAdministration',
      'routingTable',
      'classifier',
      'primarySessions',
      'execution',
      'validation',
      'permissionRelay',
      'taskApi',
      'runLaunches',
      'launchReconcile',
      'dotIntakeRecovery',
      'dotIngress',
      'dotRemoteSchema',
      'dotRemote'
    ])
  })

  it('calls every builder in that order, with each recovery before its runtime is published', async () => {
    const { fake } = await install()
    expect(fake.calls).toEqual([
      'ensureWorkbenchSchema',
      'ensureAutopilotSchema',
      'ensureDotSchema',
      'installClefAdministration',
      'createRoutingTable',
      'createClassifier',
      'classifier.recoverInterrupted',
      'createPrimarySessions',
      'primary.reconcile',
      'createExecution',
      'execution.reconcileAfterRestart',
      'createValidation',
      'installPermissionRelay',
      'reconcileLaunches',
      'recoverDotIntake',
      'reconcileLaunches',
      'runtime.installDotIngressEnabledReader',
      'ensureDotRemoteSchema',
      'createDotRemote',
      'dotRemote.start'
    ])
    expect(fake.seen.classifierAtRecovery).toBeNull()
    expect(fake.seen.primaryAtReconcile).toBeNull()
  })

  it('publishes each runtime in its registry, so the RPC layer and the door find it', async () => {
    const { fake } = await install()
    expect(getTaskClassificationRuntime()).toBe(fake.classifier)
    expect(getPrimarySessionRuntime()).not.toBeNull()
    expect(requireRoutingTableContext(fake.runtime)).toBe(fake.routingContext)
    // Why: the Settings route availability reads the same resolver the classifier and executors use.
    expect(routingTableAvailabilityOf(fake.runtime)).not.toBeNull()
    expect(() => requireAutopilotTaskApi(fake.runtime)).not.toThrow()
    expect(() => requirePermissionRelay(fake.runtime)).not.toThrow()
    expect(() => registerExecutorStopPort(fake.runtime, { stopExecutor: vi.fn() })).toThrow(
      /already registered/
    )
  })

  it('opens run launches only after the task API, the relay and the validators are in', async () => {
    const { fake, installation: installed } = await install()
    expect(await fake.seen.launchBeforeOpen).toEqual({
      ok: false,
      code: 'autopilot_primary_session_not_configured'
    })
    expect(await fake.seen.launchAfterOpen).toEqual({ ok: true })
    expect(installed.report.launchesOpen).toBe(true)
  })

  it('reads no Clef credential while it installs', async () => {
    const { ports } = await install()
    expect(ports.credentials.status).not.toHaveBeenCalled()
    expect(ports.credentials.read).not.toHaveBeenCalled()
    expect(ports.credentials.generation).not.toHaveBeenCalled()
  })

  it('recovers interrupted dot intake through a door that records the request but launches nothing', async () => {
    const { fake } = await install()
    const door = fake.seen.recoveryDoor
    if (!isIntakeDoor(door)) {
      throw new Error('the install handed recovery no intake door')
    }
    const request = { requestId: 'request-fixture-1' }
    const store = { submit: vi.fn(() => ({ request, duplicate: false })) }
    const target = { owner: fake.owner, store, principalId: 'dot-ingress', workspace: { id: 'w' } }
    const params = { workspaceId: 'w', objective: 'Fixture objective.', idempotencyKey: 'k' }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the recording door reads only these members.
    const result = await door.submit(target as never, params as never)
    expect(result).toEqual({ request, duplicate: false })
    expect(store.submit).toHaveBeenCalledWith('dot-ingress', params, target.workspace)
    await new Promise((resolve) => setImmediate(resolve))
    expect(isWorkbenchLaunchInFlight('request-fixture-1')).toBe(false)
  })

  it('installs the dot interface switch reader after intake recovery, before remote access', async () => {
    const { fake } = await install()
    expect(typeof fake.seen.dotReader).toBe('function')
    expect(fake.calls.indexOf('runtime.installDotIngressEnabledReader')).toBeGreaterThan(
      fake.calls.lastIndexOf('recoverDotIntake')
    )
    expect(fake.calls.indexOf('runtime.installDotIngressEnabledReader')).toBeLessThan(
      fake.calls.indexOf('createDotRemote')
    )
  })

  it('starts remote access last, after the dot endpoint, with the remote ports and no credential read', async () => {
    const { fake, ports } = await install()
    expect(fake.calls.at(-1)).toBe('dotRemote.start')
    expect(fake.seen.dotRemoteInput).toMatchObject({
      runtime: fake.runtime,
      owner: fake.owner,
      userDataPath: ports.userDataPath,
      credentials: ports.dotRemote.credentials,
      appVersion: '1.4.0'
    })
    for (const read of Object.values(ports.dotRemote.credentials)) {
      expect(read).not.toHaveBeenCalled()
    }
  })
})

describe('installAutopilotRuntime: the task API wiring', () => {
  it('validates a claimed in-session attempt as soon as the claim commits', async () => {
    const { fake } = await install()
    requireAutopilotTaskApi(fake.runtime).afterClaim({
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'ctx_claimed'
    })
    await vi.waitFor(() =>
      expect(fake.validation.validateAttempt).toHaveBeenCalledWith('ctx_claimed', expect.anything())
    )
  })

  it('validates a process attempt once it settled, and leaves an in-session one to its claim', async () => {
    const { fake } = await install()
    let settle: () => void = () => undefined
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    const start = (dispatchId: string, delegated: boolean, done: Promise<void>) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the wiring reads only view.dispatchId, view.delegated and settled.
      ({ view: { dispatchId, delegated }, settled: done }) as never
    vi.mocked(fake.execution.startTask)
      .mockResolvedValueOnce(start('ctx_process', true, settled))
      .mockResolvedValueOnce(start('ctx_in_session', false, Promise.resolve()))
    const api = requireAutopilotTaskApi(fake.runtime)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake start ignores its input.
    const input = { taskId: 'task_1' } as never
    await api.startTask(input)
    await api.startTask(input)
    await new Promise((resolve) => setImmediate(resolve))
    expect(fake.validation.validateAttempt).not.toHaveBeenCalled()
    settle()
    await vi.waitFor(() =>
      expect(fake.validation.validateAttempt).toHaveBeenCalledWith('ctx_process', expect.anything())
    )
    expect(fake.validation.validateAttempt).not.toHaveBeenCalledWith(
      'ctx_in_session',
      expect.anything()
    )
  })

  it('refuses a second task API for the same runtime, which is a wiring bug', async () => {
    const fake = createFakeAutopilot()
    const unregister = registerAutopilotTaskApi(fake.runtime, {
      startTask: vi.fn(),
      readAttemptResult: vi.fn(),
      afterClaim: vi.fn(),
      cliCommand: 'orca',
      now: Date.now,
      log: vi.fn()
    })
    try {
      const { installation: installed } = await install(fake)
      expect(installed.report.steps.find((step) => step.name === 'taskApi')?.status).toBe('failed')
    } finally {
      unregister()
    }
  })
})

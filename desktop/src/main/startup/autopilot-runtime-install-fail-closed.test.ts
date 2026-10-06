import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { requirePermissionRelay } from '../runtime/permission-relay/permission-relay-registry'
import { requireAutopilotTaskApi } from '../runtime/rpc/methods/orchestration/autopilot/autopilot-task-api'
import {
  getTaskClassificationRuntime,
  setTaskClassificationRuntime
} from '../runtime/task-classification/classification-runtime'
import { requireRoutingTableContext } from '../runtime/workbench-run/routing-table-context-registry'
import {
  requireWorkbenchRoutingRuntime,
  setWorkbenchRoutingRuntime
} from '../runtime/workbench-routing/workbench-routing-runtime'
import {
  requirePrimarySessionRuntime,
  setPrimarySessionRuntime
} from '../runtime/workflow-run/primary-session-runtime'
import {
  AUTOPILOT_INSTALL_STEP_NAMES,
  installAutopilotRuntime,
  type AutopilotInstallStepName,
  type AutopilotRuntimeInstallation
} from './autopilot-runtime-install'
import { fakeInstallPorts } from './autopilot-install-ports.test-fixture'
import {
  createFakeAutopilot,
  launchOutcome,
  type FakeAutopilot,
  type FakeBuilderName
} from './autopilot-runtime.test-fixture'

// The specification of fail-closed: a step runs only when every step it needs installed. A failed
// step leaves everything that needs it uninstalled, so each refuses with its documented code.
const NEEDS: Readonly<Record<AutopilotInstallStepName, readonly AutopilotInstallStepName[]>> = {
  workbenchSchema: [],
  autopilotSchema: ['workbenchSchema'],
  dotSchema: [],
  clefAdministration: ['workbenchSchema'],
  routingTable: [],
  classifier: ['autopilotSchema', 'clefAdministration', 'routingTable'],
  primarySessions: ['autopilotSchema', 'routingTable'],
  execution: ['autopilotSchema', 'routingTable'],
  validation: ['autopilotSchema', 'routingTable'],
  permissionRelay: ['autopilotSchema'],
  taskApi: ['classifier', 'execution', 'validation'],
  runLaunches: ['primarySessions', 'permissionRelay', 'taskApi'],
  launchReconcile: ['workbenchSchema', 'autopilotSchema'],
  dotIntakeRecovery: ['dotSchema', 'launchReconcile'],
  dotIngress: ['dotSchema', 'dotIntakeRecovery', 'runLaunches'],
  dotRemoteSchema: [],
  dotRemote: ['dotRemoteSchema', 'dotIngress']
}

const BUILDER_STEP: Readonly<Partial<Record<FakeBuilderName, AutopilotInstallStepName>>> = {
  ensureWorkbenchSchema: 'workbenchSchema',
  ensureAutopilotSchema: 'autopilotSchema',
  ensureDotSchema: 'dotSchema',
  installClefAdministration: 'clefAdministration',
  createRoutingTable: 'routingTable',
  createClassifier: 'classifier',
  createPrimarySessions: 'primarySessions',
  createExecution: 'execution',
  createValidation: 'validation',
  installPermissionRelay: 'permissionRelay',
  reconcileLaunches: 'launchReconcile',
  recoverDotIntake: 'dotIntakeRecovery',
  ensureDotRemoteSchema: 'dotRemoteSchema',
  createDotRemote: 'dotRemote'
}

function expectedStatuses(failed: AutopilotInstallStepName): Record<string, string> {
  const statuses: Record<string, string> = {}
  for (const name of AUTOPILOT_INSTALL_STEP_NAMES) {
    statuses[name] =
      name === failed
        ? 'failed'
        : NEEDS[name].some((need) => statuses[need] !== 'installed')
          ? 'skipped'
          : 'installed'
  }
  return statuses
}

let installation: AutopilotRuntimeInstallation | null = null

afterEach(async () => {
  await installation?.shutdown()
  installation = null
  setTaskClassificationRuntime(null)
  setPrimarySessionRuntime(null)
  setWorkbenchRoutingRuntime(null)
})

async function installWith(fake: FakeAutopilot) {
  const ports = fakeInstallPorts(fake)
  installation = await installAutopilotRuntime(ports, fake.builders)
  const statuses = Object.fromEntries(
    installation.report.steps.map((step) => [step.name, step.status])
  )
  return { ports, statuses, installation }
}

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : 'not_an_orchestration_error'
  }
}

describe('a failed install step leaves only what does not need it', () => {
  it.each(Object.entries(BUILDER_STEP))(
    'when %s throws, %s fails and its dependents skip',
    async (builder, step) => {
      const fake = createFakeAutopilot({ fail: builder as FakeBuilderName })
      const { statuses, ports } = await installWith(fake)
      expect(statuses).toEqual(expectedStatuses(step as AutopilotInstallStepName))
      expect(ports.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'install_step_failed',
          step,
          code: 'fixture_install_failed'
        })
      )
      // Never error text: a code and the step name only.
      for (const [event] of ports.log.mock.calls) {
        expect(JSON.stringify(event)).not.toContain('Fixture:')
      }
    }
  )

  it('fails the dot ingress step when the switch reader cannot be installed, and nothing else', async () => {
    const fake = createFakeAutopilot()
    vi.mocked(fake.runtime.installDotIngressEnabledReader).mockImplementation(() => {
      throw new OrchestrationError('fixture_install_failed', 'Fixture: reader refused.')
    })
    const { statuses } = await installWith(fake)
    expect(statuses).toEqual(expectedStatuses('dotIngress'))
  })

  it('fails a step that runs past its deadline and never publishes it afterwards', async () => {
    let finishReconcile: () => void = () => undefined
    const reconcile = new Promise<void>((resolve) => {
      finishReconcile = resolve
    })
    const fake = createFakeAutopilot({ reconcile })
    const ports = { ...fakeInstallPorts(fake), stepTimeoutMs: 20 }
    installation = await installAutopilotRuntime(ports, fake.builders)
    const primary = installation.report.steps.find((step) => step.name === 'primarySessions')
    expect(primary).toEqual(expect.objectContaining({ status: 'failed', code: 'step_timeout' }))
    finishReconcile()
    await new Promise((resolve) => setImmediate(resolve))
    expect(codeOf(() => requirePrimarySessionRuntime())).toBe(
      'autopilot_primary_session_not_configured'
    )
  })
})

describe('each dependent refuses with its documented unavailable code', () => {
  it('without the autopilot schema: no runs, no task API, no relay, no classifier', async () => {
    const fake = createFakeAutopilot({ fail: 'ensureAutopilotSchema' })
    await installWith(fake)
    const { runtime } = fake
    expect(codeOf(() => requirePrimarySessionRuntime())).toBe(
      'autopilot_primary_session_not_configured'
    )
    expect(getTaskClassificationRuntime()).toBeNull()
    expect(codeOf(() => requireAutopilotTaskApi(runtime))).toBe('autopilot_task_api_unavailable')
    expect(codeOf(() => requirePermissionRelay(runtime))).toBe(
      'autopilot_permission_relay_unavailable'
    )
  })

  it('without the routing table: the desktop table methods and every run refuse', async () => {
    const fake = createFakeAutopilot({ fail: 'createRoutingTable' })
    await installWith(fake)
    expect(codeOf(() => requireRoutingTableContext(fake.runtime))).toBe(
      'workbench_routing_table_unavailable'
    )
    expect(codeOf(() => requirePrimarySessionRuntime())).toBe(
      'autopilot_primary_session_not_configured'
    )
    expect(codeOf(() => requireAutopilotTaskApi(fake.runtime))).toBe(
      'autopilot_task_api_unavailable'
    )
  })

  it('without Clef administration: verification and classification refuse', async () => {
    const fake = createFakeAutopilot({ fail: 'installClefAdministration' })
    await installWith(fake)
    expect(codeOf(() => requireWorkbenchRoutingRuntime())).toBe('workbench_routing_not_configured')
    expect(getTaskClassificationRuntime()).toBeNull()
    expect(codeOf(() => requireAutopilotTaskApi(fake.runtime))).toBe(
      'autopilot_task_api_unavailable'
    )
  })

  it.each([
    'createClassifier',
    'createExecution',
    'createValidation',
    'installPermissionRelay'
  ] as const)('without %s: a run can be read and stopped, but none can start', async (builder) => {
    const fake = createFakeAutopilot({ fail: builder })
    const { installation: installed } = await installWith(fake)
    expect(installed.report.launchesOpen).toBe(false)
    expect(codeOf(() => requirePrimarySessionRuntime())).toBeNull()
    expect(await launchOutcome()).toEqual({
      ok: false,
      code: 'autopilot_primary_session_not_configured'
    })
    expect(fake.primary.startWorkflowRun).not.toHaveBeenCalled()
    expect(fake.runtime.installDotIngressEnabledReader).not.toHaveBeenCalled()
  })

  it('without the dot schema: the dot interface stays off and runs still start', async () => {
    const fake = createFakeAutopilot({ fail: 'ensureDotSchema' })
    const { installation: installed } = await installWith(fake)
    expect(fake.runtime.installDotIngressEnabledReader).not.toHaveBeenCalled()
    expect(installed.report.launchesOpen).toBe(true)
  })
})

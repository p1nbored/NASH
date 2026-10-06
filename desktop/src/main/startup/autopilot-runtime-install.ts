import {
  consoleAutopilotLog,
  DEFAULT_INSTALL_STEP_TIMEOUT_MS,
  DEFAULT_QUIT_WAIT_MS,
  emptyAutopilotParts,
  type AutopilotInstallContext,
  type AutopilotRuntimeInstallPorts
} from './autopilot-install-context'
import {
  runInstallSteps,
  type InstallStep,
  type InstallStepRecord
} from './autopilot-install-runner'
import {
  installClassifier,
  installClef,
  installExecution,
  installPrimarySessions,
  installRelay,
  installRoutingTable,
  installSchemas,
  installValidation
} from './autopilot-install-steps'
import {
  installDotIngress,
  installDotRemote,
  installTaskApi,
  openRunLaunches,
  reconcileLaunches,
  recoverDotIntake
} from './autopilot-install-steps-launch'
import type { AutopilotRuntimeBuilders } from './autopilot-runtime-builders'
import {
  shutdownAutopilotRuntime,
  type AutopilotShutdownReport
} from './autopilot-runtime-shutdown'

export type { AutopilotRuntimeInstallPorts } from './autopilot-install-context'

/** The D-016 install order (E1). Nothing here spawns an agent CLI, calls the network or reads a secret. */
export const AUTOPILOT_INSTALL_STEP_NAMES = [
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
] as const

export type AutopilotInstallStepName = (typeof AUTOPILOT_INSTALL_STEP_NAMES)[number]

export type AutopilotRuntimeInstallation = {
  readonly report: {
    readonly steps: readonly InstallStepRecord<AutopilotInstallStepName>[]
    /** True once every part a run needs is in, so runs may start. */
    readonly launchesOpen: boolean
  }
  /** Will-quit; runs once, later calls return the first call's result. */
  shutdown(): Promise<AutopilotShutdownReport>
}

type Step = InstallStep<AutopilotInstallStepName>

function steps(context: AutopilotInstallContext): readonly Step[] {
  const step = (
    name: AutopilotInstallStepName,
    needs: readonly AutopilotInstallStepName[],
    run: (signal: AbortSignal) => void | Promise<void>
  ): Step => ({ name, needs, run })
  return [
    step('workbenchSchema', [], () => installSchemas(context, 'workbench')),
    // Why after the workbench schema: the classification tables reference the Workbench family.
    step('autopilotSchema', ['workbenchSchema'], () => installSchemas(context, 'autopilot')),
    step('dotSchema', [], () => installSchemas(context, 'dot')),
    // Why the workbench schema: recovery closes reservations in the workbench spend table.
    step('clefAdministration', ['workbenchSchema'], () => installClef(context)),
    step('routingTable', [], () => installRoutingTable(context)),
    step('classifier', ['autopilotSchema', 'clefAdministration', 'routingTable'], () =>
      installClassifier(context)
    ),
    step('primarySessions', ['autopilotSchema', 'routingTable'], (signal) =>
      installPrimarySessions(context, signal)
    ),
    step('execution', ['autopilotSchema', 'routingTable'], () => installExecution(context)),
    step('validation', ['autopilotSchema', 'routingTable'], () => installValidation(context)),
    step('permissionRelay', ['autopilotSchema'], () => installRelay(context)),
    step('taskApi', ['classifier', 'execution', 'validation'], () => installTaskApi(context)),
    step('runLaunches', ['primarySessions', 'permissionRelay', 'taskApi'], () =>
      openRunLaunches(context)
    ),
    step('launchReconcile', ['workbenchSchema', 'autopilotSchema'], () =>
      reconcileLaunches(context)
    ),
    step('dotIntakeRecovery', ['dotSchema', 'launchReconcile'], () => recoverDotIntake(context)),
    step('dotIngress', ['dotSchema', 'dotIntakeRecovery', 'runLaunches'], () =>
      installDotIngress(context)
    ),
    step('dotRemoteSchema', [], () => context.builders.ensureDotRemoteSchema(context.owner)),
    // Why after dotIngress: every remote item is handed to that endpoint, never around it.
    step('dotRemote', ['dotRemoteSchema', 'dotIngress'], () => installDotRemote(context))
  ]
}

/**
 * Installs the autopilot runtime after the orchestration database opens and before the RPC server
 * starts. A failed step leaves every step that needs it uninstalled, so each dependent refuses with
 * its documented unavailable code and nothing half-works (fail closed).
 */
export async function installAutopilotRuntime(
  ports: AutopilotRuntimeInstallPorts,
  builders: AutopilotRuntimeBuilders
): Promise<AutopilotRuntimeInstallation> {
  const log = ports.log ?? consoleAutopilotLog()
  const context: AutopilotInstallContext = {
    runtime: ports.runtime,
    owner: ports.owner,
    userDataPath: ports.userDataPath,
    cliCommand: ports.cliCommand,
    now: ports.now ?? Date.now,
    log,
    ports,
    builders,
    parts: emptyAutopilotParts()
  }
  const records = await runInstallSteps(steps(context), {
    timeoutMs: ports.stepTimeoutMs ?? DEFAULT_INSTALL_STEP_TIMEOUT_MS,
    onFailed: (step, code) => log({ event: 'install_step_failed', step, code }),
    onSkipped: (step, missing) => log({ event: 'install_step_skipped', step, missing })
  })
  let stopping: Promise<AutopilotShutdownReport> | null = null
  return {
    report: { steps: records, launchesOpen: context.parts.gate?.isOpen() ?? false },
    shutdown: () => {
      stopping ??= shutdownAutopilotRuntime(context, ports.quitWaitMs ?? DEFAULT_QUIT_WAIT_MS)
      return stopping
    }
  }
}

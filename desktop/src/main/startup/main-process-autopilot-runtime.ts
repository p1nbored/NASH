import { getAppEnvironment } from '../../shared/app-environment'
import { getClefCredentialSource } from '../clef/clef-credential-port'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { localOrchestrationCliCommand } from '../runtime/orchestration/cli-command'
import { createAutopilotHostPorts, type AutopilotHostSources } from './autopilot-host-ports'
import { createProductionAutopilotBuilders } from './autopilot-production-builders'
import {
  installAutopilotRuntime,
  type AutopilotRuntimeInstallation
} from './autopilot-runtime-install'
import { installDotRemoteCredentialStore } from './dot-remote-credential-store-install'
import { createRoutingFailureLogger } from './workbench-routing-failure-log'

let installation: AutopilotRuntimeInstallation | null = null

/**
 * Installs the D-016 autopilot runtime once the runtime and the account services exist, before the
 * RPC server starts. The orchestration database opens in passive mode: the runtime needs its tables,
 * not the federation or mail delivery pumps. A failure leaves everything uninstalled, which is the
 * fail-closed default: every autopilot method refuses with its unavailable code.
 */
export async function initializeMainProcessAutopilotRuntime(
  runtime: OrcaRuntimeService,
  sources: Pick<AutopilotHostSources, 'settings' | 'rateLimits'>
): Promise<void> {
  try {
    installation = await installAutopilotRuntime(
      {
        runtime,
        owner: runtime.getOrchestrationDb({ passive: true }),
        // Why the same path source as the orchestration database, so both live in one profile.
        userDataPath: getAppEnvironment().getPath('userData'),
        cliCommand: localOrchestrationCliCommand(),
        // Why delegating: the sealed store may be (re)installed later, and Clef must see the current one.
        credentials: {
          status: () => getClefCredentialSource().status(),
          read: () => getClefCredentialSource().read(),
          generation: () => getClefCredentialSource().generation()
        },
        // Why here: the sealed store needs the OS keyring, which exists only after app 'ready'.
        dotRemote: {
          credentials: installDotRemoteCredentialStore(),
          appVersion: getAppEnvironment().getVersion()
        },
        // Why the rate-limit service: every Claude and Codex account switch already reports to it.
        accountChanges: {
          subscribe: (listener) =>
            sources.rateLimits()?.onAccountChange(listener) ?? (() => undefined)
        }
      },
      createProductionAutopilotBuilders(
        createAutopilotHostPorts({
          runtime,
          settings: sources.settings,
          rateLimits: sources.rateLimits
        })
      )
    )
  } catch (error) {
    createRoutingFailureLogger()(error)
  }
}

/** Will-quit: fences autopilot work and resolves once its runs settled (bounded); joins the quit barrier. */
export function beginAutopilotRuntimeShutdown(): Promise<void> {
  const current = installation
  installation = null
  return current ? current.shutdown().then(() => undefined) : Promise.resolve()
}

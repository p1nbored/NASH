import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { getAppEnvironment, hasAppEnvironment } from '../../../shared/app-environment'
import { executeAgentLaunch } from '../../agent-launch/agent-launch-executor'
import type { RoutingTableRuntime } from '../../routing-table/routing-table-runtime'
import { localOrchestrationCliCommand } from '../orchestration/cli-command'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import { deliverTerminalAgentLaunchPrompt } from '../rpc/methods/agent-launch-terminal-prompt'
import { createOrcaPrimaryLaunchLedger } from './primary-session-ledger'
import { withStructuredNativeChatDisabled } from './primary-session-preflight'
import { composePrimarySessionRuntime, type PrimarySessionRuntime } from './primary-session-runtime'
import {
  resolvePrimaryStatusLineRelayContext,
  type PrimaryStatusLineRelayContext
} from './primary-session-status-line-context'

/** Read at each launch, so a Git Bash installed after startup is found by the next session. */
function hostStatusLineRelay(): PrimaryStatusLineRelayContext | null {
  if (!hasAppEnvironment()) {
    return null
  }
  const app = getAppEnvironment()
  return resolvePrimaryStatusLineRelayContext({
    platform: process.platform,
    env: process.env,
    isPackaged: app.isPackaged(),
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    execPath: process.execPath,
    homeDir: homedir(),
    exists: existsSync
  })
}

export type OrcaPrimarySessionRuntimeDeps = {
  readonly runtime: OrcaRuntimeService
  readonly db: OrchestrationDb
  readonly routing: Pick<RoutingTableRuntime, 'resolver' | 'activeTable'>
  readonly userDataPath: string
}

/**
 * Binds the primary-session runtime to the running app (E1 calls this once the database is open).
 * Typed against `OrcaRuntimeService`, so the compiler proves Orca satisfies every port.
 */
export function createOrcaPrimarySessionRuntime(
  deps: OrcaPrimarySessionRuntimeDeps
): PrimarySessionRuntime {
  const { runtime } = deps
  // Why: the launch decision reads only these two; structured chat off makes it a terminal launch.
  const launchModeRuntime: Pick<
    OrcaRuntimeService,
    'getStructuredAgentSessionCreateSupport' | 'getClientSettings'
  > = {
    getStructuredAgentSessionCreateSupport: (worktree, agent) =>
      runtime.getStructuredAgentSessionCreateSupport(worktree, agent),
    getClientSettings: () => withStructuredNativeChatDisabled(runtime.getClientSettings())
  }
  return composePrimarySessionRuntime({
    db: deps.db,
    terminal: runtime,
    ledger: createOrcaPrimaryLaunchLedger(runtime),
    executeLaunch: ({ intent, surfaces }) =>
      executeAgentLaunch({ runtime: launchModeRuntime, intent, surfaces }),
    deliverAfterStart: ({ handle, text }) =>
      deliverTerminalAgentLaunchPrompt({ runtime, handle, text }),
    workspaces: { require: (workspaceId) => runtime.requireWorkbenchWorkspace(workspaceId) },
    routing: deps.routing,
    launchSettings: {
      userDataPath: deps.userDataPath,
      platform: process.platform,
      cliCommand: localOrchestrationCliCommand(),
      clientSettings: () => runtime.getClientSettings(),
      statusLineRelay: hostStatusLineRelay
    },
    clock: {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    },
    entropy: () => randomBytes(16).toString('hex'),
    newRequestId: () => randomUUID()
  })
}

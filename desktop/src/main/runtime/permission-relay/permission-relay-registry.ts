import { getAppEnvironment, hasAppEnvironment } from '../../../shared/app-environment'
import type { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { PERMISSION_RELAY_ERROR_CODES } from './permission-relay-caller'
import { PermissionRelayService } from './permission-request-service'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'

const relayByRuntime = new WeakMap<OrcaRuntimeService, PermissionRelayService>()

/** Called once at wiring time; returns the unregister. A second relay for one runtime is a wiring bug. */
export function registerPermissionRelay(
  runtime: OrcaRuntimeService,
  relay: PermissionRelayService
): () => void {
  if (relayByRuntime.has(runtime)) {
    throw new Error('A permission relay is already registered for this runtime.')
  }
  relayByRuntime.set(runtime, relay)
  return () => {
    if (relayByRuntime.get(runtime) === relay) {
      relayByRuntime.delete(runtime)
    }
  }
}

/** Until the relay is installed every relay method refuses, so the hook prints nothing (fail closed). */
export function requirePermissionRelay(runtime: OrcaRuntimeService): PermissionRelayService {
  const relay = relayByRuntime.get(runtime)
  if (!relay) {
    throw new OrchestrationError(
      PERMISSION_RELAY_ERROR_CODES.unavailable,
      'The permission relay is not running. The prompt stays in the terminal. No effects were applied.',
      { effectsApplied: false }
    )
  }
  return relay
}

/** The app's data folder (tokens, database, logs), read through the host port, never from Electron. */
export function relayAppDataDirectories(): string[] {
  return hasAppEnvironment() ? [getAppEnvironment().getPath('userData')] : []
}

/**
 * Production wiring (package E1): the runtime's own database, Orca's attested-caller check (with
 * hook attestation, no launch-token shortcut), Orca's terminal agent status and the app's data
 * folder. Returns the uninstall to run at will-quit.
 */
export function installPermissionRelay(
  runtime: OrcaRuntimeService,
  options: { cliCommand: string }
): () => void {
  const relay = new PermissionRelayService({
    getDb: () => runtime.getOrchestrationDb({ passive: true }),
    verifyCaller: (evidence) => runtime.verifyOrchestrationCompatibilityCaller(evidence),
    readStatus: (handle) => runtime.getTerminalAgentStatus(handle),
    now: () => Date.now(),
    controlPlaneCommands: [options.cliCommand],
    appDataDirectories: relayAppDataDirectories(),
    readIncarnation: (handle) => runtime.getTerminalProcessIncarnation(handle),
    notifyPrimary: (record) => {
      const db = runtime.getOrchestrationDb({ passive: true })
      const primary = getPrimarySessionStore(db).get(record.ownerId)
      if (!primary?.terminalHandle) {
        return
      }
      db.insertMessage({
        from: 'nash-permission-relay',
        to: primary.terminalHandle,
        runId: record.runId,
        subject: 'A child permission request needs review',
        body: `Read pending requests with ${options.cliCommand} orchestration permission-list --json. Request ${record.decisionId} is waiting. Critical requests require the user through Dot.`
      })
      runtime.notifyMessageArrived(primary.terminalHandle)
    }
  })
  const unregister = registerPermissionRelay(runtime, relay)
  relay.start()
  return () => {
    relay.dispose()
    unregister()
  }
}

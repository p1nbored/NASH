import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'
import { createPrimarySessionExitWatches } from './primary-session-exit-watch'
import { preparePrimarySessionLaunch } from './primary-session-launch-plan'
import {
  createPrimarySessionLauncher,
  type PrimarySessionLauncherDeps
} from './primary-session-launcher'
import type { PrimaryLaunchLedgerPort } from './primary-session-ledger'
import type { PrimarySessionClientSettings } from './primary-session-preflight'
import type { PrimarySessionClock, PrimaryTerminalPort } from './primary-session-ports'
import {
  reconcilePrimarySessions,
  type PrimarySessionReconcileReport
} from './primary-session-reconcile'
import type { SecureJsonWriter } from './primary-session-settings-file'
import type { PrimaryStatusLineRelayContext } from './primary-session-status-line-context'
import type { StatusLineSettingsReader } from './primary-session-user-status-line'
import { readPrimarySessionStatus, type PrimarySessionStatus } from './primary-session-status'
import { createPrimarySessionStopper, type PrimarySessionStopResult } from './primary-session-stop'
import {
  createRunMessageDelivery,
  type RunMessageDeliveryDeps,
  type RunMessageDeliveryInput,
  type RunMessageDeliveryResult
} from './run-message-delivery'
import type { RunMessageTimers } from './run-message-scheduling'
import {
  createWorkflowRunService,
  type StartWorkflowRunInput,
  type StartWorkflowRunResult,
  type WorkflowRunServiceDeps
} from './workflow-run-service'
import {
  readWorkflowRunController as readWorkflowRunOrigin,
  type WorkflowRunOriginRead
} from './workflow-run-origin'

/** What a launch reads from the running app to build the session arguments and settings file. */
export type PrimarySessionLaunchSettings = {
  readonly userDataPath: string
  readonly platform: NodeJS.Platform
  readonly cliCommand: string
  clientSettings(): PrimarySessionClientSettings
  readonly writeSettings?: SecureJsonWriter
  /** Resolved at each launch; null when the status-line relay cannot run on this host. */
  statusLineRelay?(): PrimaryStatusLineRelayContext | null
  readonly readSettingsText?: StatusLineSettingsReader
}

export type PrimarySessionRuntimePorts = {
  readonly db: OrchestrationDb
  readonly terminal: PrimaryTerminalPort
  readonly ledger: PrimaryLaunchLedgerPort
  readonly executeLaunch: PrimarySessionLauncherDeps['executeLaunch']
  readonly deliverAfterStart: PrimarySessionLauncherDeps['deliverAfterStart']
  readonly workspaces: WorkflowRunServiceDeps['workspaces']
  readonly routing: WorkflowRunServiceDeps['routing']
  readonly launchSettings: PrimarySessionLaunchSettings
  readonly clock: PrimarySessionClock
  entropy(): string
  newRequestId(): string
  readonly timers?: RunMessageTimers
  readonly primaryStatusChanges?: RunMessageDeliveryDeps['primaryStatusChanges']
}

export type PrimarySessionStatusRead = {
  readonly owner: PrimarySessionRecord
  readonly status: PrimarySessionStatus
}

/**
 * The port D3 (intake to run), D4 (dot ingress), UI-1 and E1 (wiring) call. Every method is in-process;
 * none is registered as an RPC or CLI method here.
 */
export type PrimarySessionRuntime = {
  startWorkflowRun(input: StartWorkflowRunInput): Promise<StartWorkflowRunResult>
  stopPrimarySession(runId: string, reason: string): Promise<PrimarySessionStopResult>
  stopRunWorkers?(runId: string): Promise<void>
  /** Null when the run has no owner record. */
  readPrimarySessionStatus(runId: string): Promise<PrimarySessionStatusRead | null>
  deliverRunMessage(input: RunMessageDeliveryInput): Promise<RunMessageDeliveryResult>
  readRunOrigin(runId: string): WorkflowRunOriginRead
  /** For an agent-status observer: flushes held messages when a dialog may have closed. */
  notifyPrimaryStatusChanged(runId: string): void
  /** Startup only, once, before anything is launched. */
  reconcile(): Promise<PrimarySessionReconcileReport & { readonly interruptedMessages: number }>
  /** Will-quit: aborts exit watches and held-message timers; never stops a session. */
  dispose(): void
}

export function composePrimarySessionRuntime(
  ports: PrimarySessionRuntimePorts
): PrimarySessionRuntime {
  const { db, terminal, clock } = ports
  const exitWatches = createPrimarySessionExitWatches({ db, terminal, clock })
  const stopper = createPrimarySessionStopper({ db, terminal, clock, exitWatches })
  const settings = ports.launchSettings
  const launcher = createPrimarySessionLauncher({
    db,
    terminal,
    ledger: ports.ledger,
    executeLaunch: ports.executeLaunch,
    prepare: (request) =>
      preparePrimarySessionLaunch(
        {
          ...request,
          userDataPath: settings.userDataPath,
          platform: settings.platform,
          cliCommand: settings.cliCommand,
          clientSettings: settings.clientSettings(),
          statusLineRelay: settings.statusLineRelay?.() ?? null
        },
        {
          ...(settings.writeSettings ? { writeSettings: settings.writeSettings } : {}),
          ...(settings.readSettingsText ? { readSettingsText: settings.readSettingsText } : {})
        }
      ),
    deliverAfterStart: ports.deliverAfterStart,
    stopUndelivered: async (owner) => {
      const stopped = await stopper.stopOwner(owner, 'launch_prompt_undelivered')
      return stopped.outcome === 'stopped' ? 'stopped' : 'stop_unconfirmed'
    },
    exitWatches,
    clock,
    entropy: ports.entropy
  })
  const service = createWorkflowRunService({
    db,
    workspaces: ports.workspaces,
    routing: ports.routing,
    launcher,
    clock
  })
  const messages = createRunMessageDelivery({
    db,
    terminal,
    clock,
    newRequestId: ports.newRequestId,
    primaryStatusChanges: ports.primaryStatusChanges,
    ...(ports.timers ? { timers: ports.timers } : {})
  })

  return {
    startWorkflowRun: (input) => service.startWorkflowRun(input),
    stopPrimarySession: (runId, reason) => stopper.stop(runId, reason),
    async readPrimarySessionStatus(runId) {
      const owner = getPrimarySessionStore(db).latestForRun(runId)
      return owner ? { owner, status: await readPrimarySessionStatus(terminal, owner) } : null
    },
    deliverRunMessage: (input) => messages.deliver(input),
    readRunOrigin: (runId) => readWorkflowRunOrigin(db, runId),
    notifyPrimaryStatusChanged: (runId) => messages.notifyPrimaryStatusChanged(runId),
    async reconcile() {
      const interruptedMessages = messages.settleInterrupted()
      const report = await reconcilePrimarySessions({
        db,
        terminal,
        ledger: ports.ledger,
        clock,
        exitWatches
      })
      return { ...report, interruptedMessages }
    },
    dispose() {
      exitWatches.cancelAll()
      messages.dispose()
    }
  }
}

let installed: PrimarySessionRuntime | null = null

/** Main startup installs the runtime after the database opens; null removes it. */
export function setPrimarySessionRuntime(runtime: PrimarySessionRuntime | null): void {
  installed = runtime
}

export function getPrimarySessionRuntime(): PrimarySessionRuntime | null {
  return installed
}

/** For RPC handlers: an uninstalled runtime refuses with a fixed code. */
export function requirePrimarySessionRuntime(): PrimarySessionRuntime {
  if (installed === null) {
    throw new OrchestrationError(
      'autopilot_primary_session_not_configured',
      'Workflow runs are not available in this session.'
    )
  }
  return installed
}

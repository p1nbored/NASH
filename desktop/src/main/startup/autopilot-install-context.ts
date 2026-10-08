import type { DotRemoteCredentialSource } from '../runtime/dot-remote/dot-remote-credentials'
import type { DotRemoteRuntime } from '../runtime/dot-remote/dot-remote-runtime'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { TaskClassificationRuntime } from '../runtime/task-classification/classification-runtime'
import type { TaskExecutionRuntime } from '../runtime/task-execution/task-execution-runtime'
import type { PrimarySessionRuntime } from '../runtime/workflow-run/primary-session-runtime'
import type { LaunchGate } from './autopilot-launch-gate'
import type { AutopilotRuntimeBuilders, RoutingTableBuild } from './autopilot-runtime-builders'
import type { AutopilotRuntimeLog } from './autopilot-runtime-events'
import type { ValidationScheduler } from './autopilot-validation-scheduler'
import type {
  ClefAdministration,
  ClefAdministrationInput
} from './workbench-routing-clef-administration'

// What every install step shares: the ports, the builders, and the parts installed so far (which
// will-quit tears down in reverse).

/** The window waits for the install, so an async step that hangs fails closed after this long. */
export const DEFAULT_INSTALL_STEP_TIMEOUT_MS = 10_000
/** Below the 20 s will-quit teardown deadline, so the dispose still runs before the app exits. */
export const DEFAULT_QUIT_WAIT_MS = 15_000

/** Says when the selected Claude or Codex account changed (Orca's rate-limit service); returns the unsubscribe. */
export type AccountChangeSource = {
  subscribe(listener: (provider: 'claude' | 'codex') => void): () => void
}

export type AutopilotRuntimeInstallPorts = {
  readonly runtime: OrcaRuntimeService
  /** The passive orchestration database: the install starts no delivery pump. */
  readonly owner: OrchestrationDb
  readonly userDataPath: string
  /** The CLI command name the agent-facing hints spell. */
  readonly cliCommand: string
  /** The sealed Clef credential source; the install never reads it. */
  readonly credentials: ClefAdministrationInput['credentials']
  readonly now?: () => number
  readonly transport?: ClefAdministrationInput['transport']
  readonly logFailure?: ClefAdministrationInput['logFailure']
  /** Remote access (R1): the sealed Sites service token and the app version; the install reads neither. */
  readonly dotRemote: {
    readonly credentials: DotRemoteCredentialSource
    readonly appVersion: string
  }
  /** Account switches, so route availability drops readings of the outgoing account. */
  readonly accountChanges?: AccountChangeSource
  /** Codes and ids only; defaults to a console line. */
  readonly log?: AutopilotRuntimeLog
  readonly stepTimeoutMs?: number
  readonly quitWaitMs?: number
}

/** The parts installed so far; a step fills its own slot, and only after it fully succeeded. */
export type AutopilotParts = {
  clef: ClefAdministration | null
  routing: RoutingTableBuild | null
  unregisterRoutingContext: (() => void) | null
  unwatchAccountChanges: (() => void) | null
  classifier: TaskClassificationRuntime | null
  primary: PrimarySessionRuntime | null
  gate: LaunchGate | null
  execution: TaskExecutionRuntime | null
  validation: ValidationScheduler | null
  unregisterValidationBacklog: (() => void) | null
  uninstallRelay: (() => void) | null
  unregisterTaskApi: (() => void) | null
  dotReaderInstalled: boolean
  dotRemote: DotRemoteRuntime | null
}

export type AutopilotInstallContext = {
  readonly runtime: OrcaRuntimeService
  readonly owner: OrchestrationDb
  readonly userDataPath: string
  readonly cliCommand: string
  readonly now: () => number
  readonly log: AutopilotRuntimeLog
  readonly ports: AutopilotRuntimeInstallPorts
  readonly builders: AutopilotRuntimeBuilders
  readonly parts: AutopilotParts
}

export function emptyAutopilotParts(): AutopilotParts {
  return {
    clef: null,
    routing: null,
    unregisterRoutingContext: null,
    unwatchAccountChanges: null,
    classifier: null,
    primary: null,
    gate: null,
    execution: null,
    validation: null,
    unregisterValidationBacklog: null,
    uninstallRelay: null,
    unregisterTaskApi: null,
    dotReaderInstalled: false,
    dotRemote: null
  }
}

/** A part a step needs; the runner skips a step whose needs are missing, so null is a wiring bug. */
export function requirePart<T>(part: T | null, name: string): T {
  if (part === null) {
    throw new Error(`The autopilot install step ran without its ${name}.`)
  }
  return part
}

/** The default sink: one console line of codes and ids, never error text. */
export function consoleAutopilotLog(): AutopilotRuntimeLog {
  return (event) => {
    console.warn('[autopilot-runtime]', JSON.stringify(event))
  }
}

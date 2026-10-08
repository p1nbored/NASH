import type { NativeReviewerDeps } from '../runtime/task-validation/reviewer-runner'
import type { LaunchTarget } from '../agent-exec-shared/launch-target'
import type { AgyExecutable } from '../agy-exec/agy-exec-executable'
import type { RoutingTableContext } from '../routing-table/routing-table-context'
import type {
  RoutingTableRuntime,
  RoutingTableRuntimePorts
} from '../routing-table/routing-table-runtime'
import type { DotIntakeDoor } from '../runtime/dot-ingress/dot-ingress-ports'
import type { DotRemoteCredentialSource } from '../runtime/dot-remote/dot-remote-credentials'
import type { DotRemoteRuntime } from '../runtime/dot-remote/dot-remote-runtime'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type {
  ClassificationSettled,
  TaskClassificationRuntime
} from '../runtime/task-classification/classification-runtime'
import type { TaskExecutionRuntime } from '../runtime/task-execution/task-execution-runtime'
import type { ValidationRunner } from '../runtime/task-validation/validation-runner'
import type { WorkbenchLaunchReconcileReport } from '../runtime/workbench-intake-reconcile'
import type { PrimarySessionRuntime } from '../runtime/workflow-run/primary-session-runtime'
import type { AutopilotRuntimeLog } from './autopilot-runtime-events'
import type {
  ClefAdministration,
  ClefAdministrationInput,
  ClefClassifierPorts
} from './workbench-routing-clef-administration'

// The parts the autopilot install composes, as replaceable builders: production binds the real
// modules, tests bind fakes, and the install order lives in one place (autopilot-runtime-install).

/** What the running app lends the routing table and the executors; every member is read on demand. */
export type AutopilotHostPorts = Pick<
  RoutingTableRuntimePorts,
  'agents' | 'models' | 'rateLimits' | 'codex'
> & {
  readonly reviewer: Pick<NativeReviewerDeps, 'resolveInvocation'>
  readonly agy: { readonly resolveExecutable: () => AgyExecutable }
  /** The installed Claude Code launch target for `claude -p` reviews, or null. */
  readonly claude: { readonly resolveExecutable: () => LaunchTarget | null }
}

export type RoutingTableBuild = {
  readonly context: RoutingTableContext
  readonly runtime: RoutingTableRuntime
}

export type ClassifierBuildInput = {
  readonly owner: OrchestrationDb
  readonly clef: ClefClassifierPorts
  readonly routing: RoutingTableRuntime
  readonly now: () => number
  readonly onSettled: (settled: ClassificationSettled) => void
  readonly onFailure: (error: unknown) => void
}

export type RuntimeBuildInput = {
  readonly runtime: OrcaRuntimeService
  readonly owner: OrchestrationDb
  readonly routing: RoutingTableRuntime
  readonly userDataPath: string
}

export type ExecutionBuildInput = RuntimeBuildInput & {
  readonly cliCommand: string
  readonly now: () => number
  readonly log: AutopilotRuntimeLog
}

export type DotIntakeRecovery = { submitted: number; failed: number; pending: number }

export type DotRemoteBuildInput = {
  readonly runtime: OrcaRuntimeService
  readonly owner: OrchestrationDb
  readonly userDataPath: string
  readonly credentials: DotRemoteCredentialSource
  readonly appVersion: string
  readonly log: AutopilotRuntimeLog
}

export type AutopilotRuntimeBuilders = {
  ensureWorkbenchSchema(owner: OrchestrationDb): void
  ensureAutopilotSchema(owner: OrchestrationDb): void
  ensureDotSchema(owner: OrchestrationDb): void
  installClefAdministration(input: ClefAdministrationInput): ClefAdministration
  createRoutingTable(input: { userDataPath: string; now: () => number }): RoutingTableBuild
  createClassifier(input: ClassifierBuildInput): TaskClassificationRuntime
  createPrimarySessions(input: RuntimeBuildInput): PrimarySessionRuntime
  createExecution(input: ExecutionBuildInput): TaskExecutionRuntime
  createValidation(input: RuntimeBuildInput): ValidationRunner
  /** Returns the uninstall. */
  installPermissionRelay(input: { runtime: OrcaRuntimeService; cliCommand: string }): () => void
  reconcileLaunches(owner: OrchestrationDb): WorkbenchLaunchReconcileReport
  recoverDotIntake(input: {
    runtime: OrcaRuntimeService
    door: DotIntakeDoor
  }): Promise<DotIntakeRecovery>
  /** Will-quit: resolves once every run launch in flight has settled. */
  settleLaunches(): Promise<void>
  ensureDotRemoteSchema(owner: OrchestrationDb): void
  /** Builds remote access and registers its desktop control; it polls nothing until switched on and paired. */
  createDotRemote(input: DotRemoteBuildInput): DotRemoteRuntime
}

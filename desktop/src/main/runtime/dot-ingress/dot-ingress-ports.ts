import type {
  WorkbenchCancelResult,
  WorkbenchSubmitResult
} from '../../../shared/workbench-request'
import type {
  WorkbenchCancelInput,
  WorkbenchSubmitInput
} from '../../../shared/rpc-contract/workbench-params'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import type { MessageRow } from '../orchestration/types'
import type { AttemptWorktreeChangesReader } from '../task-validation/attempt-worktree-changes'
import type { PermissionRelayService } from '../permission-relay/permission-request-service'
import type { WorkbenchLocalWorkspace } from '../workbench-local-workspace'
import type { WorkbenchIntakeTarget } from '../workbench-intake-submit'
import type { PrimarySessionRuntime } from '../workflow-run/primary-session-runtime'

/**
 * The single intake door (owned by the intake package) as the dot services call it. Results are
 * awaited, so a door that launches the run before it returns fits as well as a synchronous one.
 */
export type DotIntakeDoor = {
  submit(
    target: WorkbenchIntakeTarget,
    params: WorkbenchSubmitInput
  ): Promise<WorkbenchSubmitResult> | WorkbenchSubmitResult
  /** Stops the request's run first when one was launched, then cancels the request. */
  cancel(
    target: WorkbenchIntakeTarget,
    params: WorkbenchCancelInput
  ): Promise<WorkbenchCancelResult> | WorkbenchCancelResult
}

/** The relay calls dot may reach: list what it may see and answer through the first-answer-wins path. */
export type DotDecisionRelay = Pick<PermissionRelayService, 'listForDot' | 'answerFromDot'>

/** The follow-up message path of the primary-session runtime (D-019). */
export type DotRunMessenger = Pick<PrimarySessionRuntime, 'deliverRunMessage'>

export type DotIngressServiceDeps = {
  /** The passive orchestration database: dot calls never start delivery pumps. */
  readonly db: OrchestrationDb
  /** Re-admits a workspace; throws when it is gone, remote or ambiguous. */
  requireWorkspace(workspaceId: string): WorkbenchLocalWorkspace
  readonly door: DotIntakeDoor
  /** Throws `autopilot_permission_relay_unavailable` while no relay is installed. */
  relay(): DotDecisionRelay
  /** Throws `autopilot_primary_session_not_configured` while no runtime is installed. */
  messenger(): DotRunMessenger
  /** Wakes the run's mailbox readers for a notice a validation decision filed (G6's service). */
  announce(message: MessageRow): void
  /** Git facts of a waived attempt's own worktree, as the desktop decision reads them; absent, none. */
  readonly readWorktreeChanges?: AttemptWorktreeChangesReader
  now(): Date
}

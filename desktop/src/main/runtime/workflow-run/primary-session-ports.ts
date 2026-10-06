import type {
  RuntimeTerminalAgentStatus,
  RuntimeTerminalClose,
  RuntimeTerminalCreate,
  RuntimeTerminalSend,
  RuntimeTerminalWait,
  RuntimeTerminalWaitCondition
} from '../../../shared/runtime-terminal-contracts'
import type { TerminalInputKind } from '../../../shared/terminal-input-kind'
import type {
  RuntimeAgentPromptWriteOptions,
  TerminalCreateOptions
} from '../runtime-terminal-contracts'

/**
 * The slice of Orca's runtime that launches, reads and drives a run's primary session. Each method is
 * Orca's own (`OrcaRuntimeService` satisfies this type); tests pass fakes, so nothing here spawns.
 */
export type PrimaryTerminalPort = {
  createTerminal(
    worktreeSelector: string,
    opts: TerminalCreateOptions
  ): Promise<RuntimeTerminalCreate>
  getTerminalAgentStatus(handle: string): Promise<RuntimeTerminalAgentStatus>
  getTerminalProcessIncarnation(handle: string): string | null
  getTerminalHandleForPaneKey(paneKey: string): string | null
  getOrchestrationDispatchAuthority(
    handle: string
  ): { readonly launchTokenHash: string | null } | null
  waitForTerminal(
    handle: string,
    options?: { condition?: RuntimeTerminalWaitCondition; timeoutMs?: number; signal?: AbortSignal }
  ): Promise<RuntimeTerminalWait>
  sendTerminal(
    handle: string,
    action: { text?: string; enter?: boolean; interrupt?: boolean },
    options: { inputKind: TerminalInputKind }
  ): Promise<RuntimeTerminalSend>
  closeTerminal(handle: string): Promise<RuntimeTerminalClose>
  sendTerminalAgentPrompt(
    handle: string,
    prompt: string,
    options: RuntimeAgentPromptWriteOptions
  ): Promise<RuntimeTerminalSend>
}

export type PrimarySessionClock = {
  now(): number
  sleep(ms: number): Promise<void>
}

/** Store timestamps are `toISOString()` output only. */
export function clockTimestamp(clock: Pick<PrimarySessionClock, 'now'>): string {
  return new Date(clock.now()).toISOString()
}

/** The launch-blocker details B1 added for D-016 (`D016_ROUTE_BLOCKER_DETAIL_EXTENSIONS`) that a launch uses. */
export const WORKFLOW_RUN_LAUNCH_BLOCKER_DETAILS = [
  'coordinator_route_unavailable',
  'launch_refused',
  'launch_unverifiable'
] as const
export type WorkflowRunLaunchBlockerDetail = (typeof WORKFLOW_RUN_LAUNCH_BLOCKER_DETAILS)[number]

/** One blocker for the intake request: `reason` is always B1's `launch_blocked`. */
export type WorkflowRunLaunchBlocker = {
  readonly reason: 'launch_blocked'
  readonly detail: WorkflowRunLaunchBlockerDetail
  /** An `autopilot_*` code naming the exact cause; never carries input text or secrets. */
  readonly code: string
  /** One English sentence. */
  readonly message: string
}

export function launchBlocker(
  detail: WorkflowRunLaunchBlockerDetail,
  code: string,
  message: string
): WorkflowRunLaunchBlocker {
  return { reason: 'launch_blocked', detail, code, message }
}

/** A short error code read from a thrown value, never its free text (which may carry a secret). */
export function errorCodeOf(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.message
        : ''
  return /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'unexpected_error'
}

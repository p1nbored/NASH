import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import type { PrimarySessionRuntime } from '../runtime/workflow-run/primary-session-runtime'

// The primary-session runtime as the app publishes it: status, stop and messages work from the
// moment it is installed, but a run starts only once every part it needs is installed, so a run
// never launches half-wired (D-016 E1). Will-quit closes the gate again before anything is torn down.

export type LaunchGate = {
  /** The runtime to publish; its startWorkflowRun refuses while the gate is closed. */
  readonly runtime: PrimarySessionRuntime
  open(): void
  close(): void
  isOpen(): boolean
}

function launchesClosed(): OrchestrationError {
  // Why this code: the door and the RPC layer already map it to a launch refused before any effect.
  return new OrchestrationError(
    'autopilot_primary_session_not_configured',
    'Workflow runs are not available in this session.'
  )
}

export function createLaunchGate(primary: PrimarySessionRuntime): LaunchGate {
  let open = false
  const runtime: PrimarySessionRuntime = {
    ...primary,
    startWorkflowRun: (input) =>
      open ? primary.startWorkflowRun(input) : Promise.reject(launchesClosed())
  }
  return {
    runtime,
    open: () => {
      open = true
    },
    close: () => {
      open = false
    },
    isOpen: () => open
  }
}

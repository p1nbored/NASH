import type { OrcaRuntimeService } from '../orca-runtime'
import { requirePermissionRelay } from '../permission-relay/permission-relay-registry'
import { createAttemptWorktreeChangesReader } from '../task-validation/attempt-worktree-changes'
import { cancelWorkbenchRequest, submitWorkbenchRequest } from '../workbench-intake-submit'
import { requirePrimarySessionRuntime } from '../workflow-run/primary-session-runtime'
import type { DotIngressServiceDeps, DotIntakeDoor } from './dot-ingress-ports'

/** The intake package's single door, unchanged: dot submissions and cancels take the desktop's path. */
const SINGLE_INTAKE_DOOR: DotIntakeDoor = {
  submit: (target, params) => submitWorkbenchRequest(target, params),
  cancel: (target, params) => cancelWorkbenchRequest(target, params)
}

/**
 * The production wiring of the dot services for one call. The database is opened passively, and the
 * relay and the primary-session runtime are looked up per call, so an uninstalled one refuses cleanly.
 */
export function dotIngressServiceDeps(runtime: OrcaRuntimeService): DotIngressServiceDeps {
  return {
    db: runtime.getOrchestrationDb({ passive: true }),
    requireWorkspace: (workspaceId) => runtime.requireWorkbenchWorkspace(workspaceId),
    door: SINGLE_INTAKE_DOOR,
    relay: () => requirePermissionRelay(runtime),
    messenger: () => requirePrimarySessionRuntime(),
    announce: (message) => runtime.notifyMessageArrived(message.to_handle, message.type),
    // Why the desktop's reader: a waive from dot files the same notice as one from the desktop.
    readWorktreeChanges: createAttemptWorktreeChangesReader({
      resolvePath: async (worktreeId) => runtime.requireWorkbenchWorkspace(worktreeId).path
    }),
    now: () => new Date()
  }
}

import { join } from 'node:path'
import { createNodeAvailabilityFs } from '../routing-table/availability/route-availability-fs'
import { createRoutingTableContext } from '../routing-table/routing-table-context'
import { createNodeRoutingTableFs } from '../routing-table/routing-table-file-store'
import { proposeBundledUpdate } from '../routing-table/routing-table-proposals'
import { createRoutingTableRuntime } from '../routing-table/routing-table-runtime'
import { recoverDotIntake } from '../runtime/dot-ingress/dot-ingress-intake'
import { dotIngressServiceDeps } from '../runtime/dot-ingress/dot-ingress-runtime-deps'
import { createDotRemoteRuntime } from '../runtime/dot-remote/dot-remote-runtime'
import { ensureDotRemoteSchema } from '../runtime/dot-remote/dot-remote-schema'
import { ensureAutopilotRuntimeSchema } from '../runtime/orchestration/db/autopilot-runtime-schema'
import { ensureDotIngressSchema } from '../runtime/orchestration/db/dot-ingress-schema'
import { ensureWorkbenchRequestSchema } from '../runtime/orchestration/db/workbench-request-schema'
import { installPermissionRelay } from '../runtime/permission-relay/permission-relay-registry'
import { createTaskClassificationRuntime } from '../runtime/task-classification/classification-runtime'
import { createRuntimeAttemptWorktreePort } from '../runtime/task-execution/attempt-worktree-runtime'
import { createTaskExecutionRuntime } from '../runtime/task-execution/task-execution-runtime'
import { createTaskValidationRuntime } from '../runtime/task-validation/task-validation-runtime'
import { settleWorkbenchLaunches } from '../runtime/workbench-intake-launch'
import { reconcileWorkbenchLaunches } from '../runtime/workbench-intake-reconcile'
import { createOrcaPrimarySessionRuntime } from '../runtime/workflow-run/primary-session-runtime-orca'
import type { AutopilotHostPorts, AutopilotRuntimeBuilders } from './autopilot-runtime-builders'
import { createValidationRoots } from './autopilot-validation-roots'
import { installClefAdministration } from './workbench-routing-clef-administration'

/** Reviewer run folders, beside the attempt run folders under the app's data folder. */
export const REVIEW_RUNS_FOLDER = 'autopilot-reviews'

/**
 * The real modules behind each builder. Building any of them starts nothing: no process, no
 * network call and no credential read; the host ports are read only when a route is checked.
 */
export function createProductionAutopilotBuilders(
  host: AutopilotHostPorts
): AutopilotRuntimeBuilders {
  return {
    ensureWorkbenchSchema: (owner) => ensureWorkbenchRequestSchema(owner.db),
    ensureAutopilotSchema: (owner) => ensureAutopilotRuntimeSchema(owner.db),
    ensureDotSchema: (owner) => ensureDotIngressSchema(owner.db),
    installClefAdministration,
    createRoutingTable: ({ userDataPath, now }) => {
      const paths = { getUserDataPath: () => userDataPath }
      const context = createRoutingTableContext({ paths, fs: createNodeRoutingTableFs() })
      // Why: installs the bundled table on the first start and offers a newer bundled one; a damaged store is reported, never replaced.
      proposeBundledUpdate(context)
      const runtime = createRoutingTableRuntime({
        now,
        routingTable: context,
        files: { paths, fs: createNodeAvailabilityFs() },
        agents: host.agents,
        models: host.models,
        rateLimits: host.rateLimits,
        codex: host.codex
      })
      return { context, runtime }
    },
    createClassifier: ({ owner, clef, routing, now, onSettled, onFailure }) =>
      createTaskClassificationRuntime({
        owner,
        ...clef,
        routing: {
          activeTable: () => routing.activeTable(),
          resolveRoute: (input) => routing.resolver.resolveRoute(input)
        },
        clock: { now },
        onSettled,
        onFailure
      }),
    createPrimarySessions: ({ runtime, owner, routing, userDataPath }) =>
      createOrcaPrimarySessionRuntime({ runtime, db: owner, routing, userDataPath }),
    createExecution: ({ runtime, owner, routing, userDataPath, cliCommand, now, log }) => {
      const workspacePath = (workspaceId: string): string =>
        runtime.requireWorkbenchWorkspace(workspaceId).path
      return createTaskExecutionRuntime({
        owner,
        routes: routing.resolver,
        now,
        cliCommand,
        userDataPath,
        workspacePath,
        // D-025: a write attempt in a git workspace gets its own child worktree of the run worktree.
        worktrees: createRuntimeAttemptWorktreePort({ runtime, workspacePath }),
        announce: (message) => runtime.notifyMessageArrived(message.to_handle, message.type),
        log: ({ event, code, dispatchId }) =>
          log({
            event: 'execution_event',
            detail: event,
            ...(code ? { code } : {}),
            ...(dispatchId ? { dispatchId } : {})
          }),
        codex: { resolveExecutable: host.codex.resolveExecutable },
        agy: { resolveExecutable: host.agy.resolveExecutable }
      })
    },
    createValidation: ({ runtime, owner, routing, userDataPath }) =>
      createTaskValidationRuntime({
        owner,
        roots: createValidationRoots({
          requireWorkspace: (workspaceId) => runtime.requireWorkbenchWorkspace(workspaceId),
          userDataPath
        }),
        resolver: routing.resolver,
        reviewRunsRoot: join(userDataPath, REVIEW_RUNS_FOLDER),
        codex: { resolveExecutable: host.codex.resolveExecutable },
        claude: {
          resolveExecutable: host.claude.resolveExecutable,
          electron: { isElectron: Boolean(process.versions.electron), execPath: process.execPath }
        }
      }),
    installPermissionRelay: ({ runtime, cliCommand }) =>
      installPermissionRelay(runtime, { cliCommand }),
    reconcileLaunches: (owner) => reconcileWorkbenchLaunches(owner),
    recoverDotIntake: ({ runtime, door }) =>
      recoverDotIntake({ ...dotIngressServiceDeps(runtime), door }),
    settleLaunches: () => settleWorkbenchLaunches(),
    ensureDotRemoteSchema: (owner) => ensureDotRemoteSchema(owner.db),
    createDotRemote: ({ runtime, owner, userDataPath, credentials, appVersion, log }) =>
      createDotRemoteRuntime({
        runtime,
        owner,
        userDataPath,
        credentials,
        appVersion,
        log: (event) =>
          log({
            event: 'dot_remote_event',
            detail: event.event,
            ...(typeof event.code === 'string' ? { code: event.code } : {})
          })
      })
  }
}

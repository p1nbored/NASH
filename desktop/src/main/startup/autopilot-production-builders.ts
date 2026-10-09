import { agentHookServer } from '../agent-hooks/server'
import { createNodeAvailabilityFs } from '../routing-table/availability/route-availability-fs'
import { createRoutingTableContext } from '../routing-table/routing-table-context'
import { createNodeRoutingTableFs } from '../routing-table/routing-table-file-store'
import { ensureActiveRoutingTable } from '../routing-table/routing-table-activation'
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
import { startRoutedNativeWorker } from '../runtime/task-execution/task-start-native'
import { createTaskExecutionRuntime } from '../runtime/task-execution/task-execution-runtime'
import { createTaskValidationRuntime } from '../runtime/task-validation/task-validation-runtime'
import { settleWorkbenchLaunches } from '../runtime/workbench-intake-launch'
import { reconcileWorkbenchLaunches } from '../runtime/workbench-intake-reconcile'
import { createOrcaPrimarySessionRuntime } from '../runtime/workflow-run/primary-session-runtime-orca'
import type { AutopilotHostPorts, AutopilotRuntimeBuilders } from './autopilot-runtime-builders'
import { createValidationRoots } from './autopilot-validation-roots'
import { installClefAdministration } from './workbench-routing-clef-administration'

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
      // Why: installs the bundled table on the first start; a damaged store is reported, never replaced.
      ensureActiveRoutingTable(context)
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
      createOrcaPrimarySessionRuntime({
        runtime,
        db: owner,
        routing,
        userDataPath,
        primaryStatusChanges: agentHookServer
      }),
    createExecution: ({ runtime, owner, routing, cliCommand, now, log }) => {
      return createTaskExecutionRuntime({
        owner,
        startWorker: (input, route) => startRoutedNativeWorker(runtime, input, route),
        routes: routing.resolver,
        now,
        cliCommand,
        log: ({ event, code, dispatchId }) =>
          log({
            event: 'execution_event',
            detail: event,
            ...(code ? { code } : {}),
            ...(dispatchId ? { dispatchId } : {})
          })
      })
    },
    createValidation: ({ runtime, owner, routing }) =>
      createTaskValidationRuntime({
        owner,
        roots: createValidationRoots({
          requireWorkspace: (workspaceId) => runtime.requireWorkbenchWorkspace(workspaceId)
        }),
        resolver: routing.resolver,
        reviewer: host.reviewer
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

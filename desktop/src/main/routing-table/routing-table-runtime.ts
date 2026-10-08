import type { CodexExecutable } from '../codex-exec/codex-exec-executable'
import {
  createRouteAvailabilityEvaluator,
  type AvailabilityPorts,
  type RouteAvailabilityEvaluator
} from './availability/route-availability-evaluator'
import type { AvailabilityFs } from './availability/route-availability-fs'
import { createRouteAvailabilityStore } from './availability/route-availability-store'
import type { RouteProvider } from './availability/route-availability-types'
import type { ModelListingPort } from './availability/model-listing'
import type { AgentDetectionSources } from './availability/route-cli-detection-check'
import { resolveActiveRoutingTable, type ResolvedRoutingTable } from './routing-table-activation'
import type { RoutingTableContext } from './routing-table-context'
import type { RoutingTablePathPort } from './routing-table-file-store'
import { createRouteResolver, type RouteResolver } from './route-resolver'

/**
 * What the routing table needs from the running app, as ports: the startup wiring binds each one to
 * the app's own service (agent detection, the catalog probes, the rate-limit service, the Codex
 * executable resolver) so this module reaches none of them directly and needs no Electron runtime.
 */
export type RoutingTableRuntimePorts = {
  readonly now: () => number
  /** The routing-table store and clock, also used by settings saves. */
  readonly routingTable: RoutingTableContext
  /**
   * Where availability keeps its latches: the same user data folder as the table. `createNodeAvailabilityFs()`
   * is the production file system; it can also set a damaged latch file aside.
   */
  readonly files: { readonly paths: RoutingTablePathPort; readonly fs: AvailabilityFs }
  /** Agent detection plus the user's disabled-agents setting. */
  readonly agents: AgentDetectionSources
  /** One session-less model listing per CLI; each never rejects. */
  readonly models: Readonly<Record<RouteProvider, ModelListingPort>>
  /** The rate-limit service: its state, and its refresh (bounded and rate-limited by the runtime). */
  readonly rateLimits: AvailabilityPorts['rateLimits']
  /** `resolveCodexExecutable` bound exactly as the Codex runner resolves it. */
  readonly codex: { readonly resolveExecutable: () => CodexExecutable }
}

export type RoutingTableRuntime = {
  readonly resolver: RouteResolver
  readonly evaluator: RouteAvailabilityEvaluator
  /** The active table, or why there is none; reads only. */
  activeTable(): ResolvedRoutingTable
}

export function createRoutingTableRuntime(ports: RoutingTableRuntimePorts): RoutingTableRuntime {
  const store = createRouteAvailabilityStore({ ...ports.files, now: ports.now })
  const evaluator = createRouteAvailabilityEvaluator({
    store,
    ports: {
      now: ports.now,
      detection: ports.agents,
      models: ports.models,
      rateLimits: ports.rateLimits,
      resolveCodexExecutable: ports.codex.resolveExecutable
    }
  })
  const activeTable = (): ResolvedRoutingTable => resolveActiveRoutingTable(ports.routingTable)
  return { resolver: createRouteResolver({ activeTable, evaluator }), evaluator, activeTable }
}

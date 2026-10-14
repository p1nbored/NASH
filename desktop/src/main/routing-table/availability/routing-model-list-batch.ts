import { ROUTING_AGENTS } from '../../../shared/routing-table/routing-cli-registry'
import type { ModelListing } from './model-listing'
import {
  providerForAgent,
  type ModelListings,
  type RouteProvider
} from './route-availability-types'

/** Optional providers keep callers and older hosts that only expose the original three compatible. */
export async function readRoutingModelLists(
  ports: Readonly<Partial<Record<RouteProvider, unknown>>>,
  obtain: (provider: RouteProvider) => Promise<ModelListing>
): Promise<ModelListings> {
  const [[claude, codex, agy], extra] = await Promise.all([
    Promise.all((['claude', 'codex', 'agy'] as const).map(obtain)),
    Promise.all(
      ROUTING_AGENTS.map(providerForAgent)
        .filter((provider) => !['claude', 'codex', 'agy'].includes(provider) && ports[provider])
        .map(async (provider) => [provider, await obtain(provider)] as const)
    )
  ])
  return { claude, codex, agy, ...Object.fromEntries(extra) }
}

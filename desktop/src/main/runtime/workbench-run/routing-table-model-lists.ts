import { modelPinViolation } from '../../../shared/routing-table/model-pin-policy'
import type { RoutingModel, RoutingModelLists } from '../../../shared/workbench-routing-table-view'
import type { ModelListing } from '../../routing-table/availability/model-listing'
import type { RoutingTableAvailabilitySource } from './routing-table-availability-view'

export function listedRoutingModels(listing: ModelListing): RoutingModel[] | null {
  if (!listing.ok) {
    return null
  }
  const models = new Map<string, RoutingModel>()
  for (const row of listing.models) {
    const id = row.resolvedModel ?? row.id
    if (modelPinViolation(id) !== null) {
      continue
    }
    const previous = models.get(id)
    models.set(id, {
      id,
      label: previous?.label ?? row.label,
      efforts: previous
        ? previous.efforts.filter((effort) => row.efforts.includes(effort))
        : [...row.efforts]
    })
  }
  return [...models.values()]
}

export async function routingModelLists(
  source: RoutingTableAvailabilitySource | null,
  freshness: 'cached' | 'recheck'
): Promise<RoutingModelLists> {
  const lists = await source?.listModels?.(freshness)
  return lists
    ? {
        claude: listedRoutingModels(lists.claude),
        codex: listedRoutingModels(lists.codex),
        agy: listedRoutingModels(lists.agy)
      }
    : { claude: null, codex: null, agy: null }
}

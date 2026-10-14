import { modelPinViolation } from '../../../shared/routing-table/model-pin-policy'
import { CONCRETE_REASONING_LEVELS } from '../../../shared/routing-table/routing-table-taxonomy'
import type { RoutingModel, RoutingModelLists } from '../../../shared/workbench-routing-table-view'
import type { ModelListing } from '../../routing-table/availability/model-listing'
import type { RoutingTableAvailabilitySource } from './routing-table-availability-view'

export function listedRoutingModels(
  listing: ModelListing | undefined,
  agy = false
): RoutingModel[] | null {
  if (!listing?.ok) {
    return null
  }
  const models = new Map<string, RoutingModel>()
  for (const row of listing.models) {
    const id = row.resolvedModel ?? row.id
    if (modelPinViolation(id) !== null) {
      continue
    }
    const previous = models.get(id)
    const variant = agy
      ? CONCRETE_REASONING_LEVELS.find((level) => id.endsWith(`-${level}`))
      : undefined
    const efforts = variant ? [variant] : row.efforts
    models.set(id, {
      id,
      label: previous?.label ?? row.label,
      efforts: previous
        ? previous.efforts.filter((effort) => efforts.includes(effort))
        : [...efforts]
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
        agy: listedRoutingModels(lists.agy, true),
        gemini: listedRoutingModels(lists.gemini),
        cursor: listedRoutingModels(lists.cursor),
        codebuddy: listedRoutingModels(lists.codebuddy),
        grok: listedRoutingModels(lists.grok),
        muse: listedRoutingModels(lists.muse),
        omp: listedRoutingModels(lists.omp),
        opencode: listedRoutingModels(lists.opencode)
      }
    : { claude: null, codex: null, agy: null }
}

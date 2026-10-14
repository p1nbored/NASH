import { getAgentModelProbeSpec } from '../../../shared/agent-model-probe-spec'
import { getAgentSessionOptionLaunchCatalog } from '../../../shared/agent-session-option-launch'
import type { RoutingAgent } from '../../../shared/routing-table/routing-cli-registry'
import { catalogRoutingEfforts } from '../../../shared/routing-table/routing-model-options'
import type { DiscoverCommitMessageModelsResult } from '../../text-generation/source-control-text-generation-types'
import type { ListedModel, ModelListing } from './model-listing'

/** A dynamic probe owns membership; static-only CLIs use their native launch catalog. */
export function nativeRouteModelListing(
  agent: RoutingAgent,
  discovery: DiscoverCommitMessageModelsResult | null,
  observedAtMs: number
): ModelListing {
  const catalog = getAgentSessionOptionLaunchCatalog(agent)!
  const spec = getAgentModelProbeSpec(agent)
  if (
    spec?.modelSource === 'dynamic' &&
    (!discovery?.success || discovery.catalogOrigin !== 'probe')
  ) {
    return { ok: false, observedAtMs }
  }
  const discovered = discovery?.success ? discovery.models : []
  const models =
    spec?.modelSource === 'dynamic'
      ? discovered
      : [...new Map([...catalog.models, ...discovered].map((model) => [model.id, model])).values()]
  const rows: ListedModel[] = models.map((model) => ({
    id: model.id,
    label: model.label,
    resolvedModel: null,
    efforts: catalogRoutingEfforts(agent, model.id)
  }))
  const acceptsUnlistedModels =
    !spec?.modelDiscovery && !catalog.models.length && !!catalog.unknownModelOptions
  return rows.length || acceptsUnlistedModels
    ? {
        ok: true,
        models: rows,
        observedAtMs,
        source: spec?.modelSource === 'dynamic' ? 'probe' : 'catalog',
        ...(acceptsUnlistedModels ? { acceptsUnlistedModels: true } : {})
      }
    : { ok: false, observedAtMs }
}

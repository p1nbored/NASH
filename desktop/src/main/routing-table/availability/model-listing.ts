import type { AgentSessionModelOption } from '../../../shared/agent-session-wire'
import type { DiscoverCommitMessageModelsResult } from '../../text-generation/source-control-text-generation-types'

/** One row of a CLI's model listing, reduced to what a route check compares. */
export type ListedModel = {
  readonly id: string
  /** The full model id the listed value resolves to, when the CLI names one (Claude aliases). */
  readonly resolvedModel: string | null
  readonly label: string
  /** The effort values the listing names for this model; empty when it has no effort control. */
  readonly efforts: readonly string[]
}

/** A failed or empty listing never admits a model: only `ok` with at least one row is evidence. */
export type ModelListing =
  | { readonly ok: true; readonly models: readonly ListedModel[]; readonly observedAtMs: number }
  | { readonly ok: false; readonly observedAtMs: number }

/** The part of Orca's probe answer a listing needs; the Claude probe adds the resolved-id map. */
export type CatalogProbeSuccess = {
  readonly models: readonly AgentSessionModelOption[]
  readonly resolvedModelByModel?: ReadonlyMap<string, string>
}

/** From the Claude or Codex catalog probe: the account's own listing, not a bundled seed. */
export function listingFromCatalogSuccess(
  success: CatalogProbeSuccess,
  observedAtMs: number
): ModelListing {
  if (success.models.length === 0) {
    return { ok: false, observedAtMs }
  }
  return {
    ok: true,
    observedAtMs,
    models: success.models.map((model) => ({
      id: model.id,
      resolvedModel: success.resolvedModelByModel?.get(model.id) ?? null,
      label: model.label,
      efforts: model.efforts.map((effort) => effort.value)
    }))
  }
}

/**
 * From Orca's one-shot discovery (agy). The static fallback list the discovery returns when the CLI
 * printed nothing usable is not what the CLI listed, so it is no listing.
 */
export function listingFromDiscovery(
  result: DiscoverCommitMessageModelsResult,
  observedAtMs: number
): ModelListing {
  if (!result.success || result.catalogOrigin !== 'probe') {
    return { ok: false, observedAtMs }
  }
  const models = result.models
    .filter((model) => model.id.trim() !== '')
    .map((model): ListedModel => ({
      id: model.id,
      resolvedModel: null,
      label: model.label,
      efforts: []
    }))
  return models.length === 0 ? { ok: false, observedAtMs } : { ok: true, observedAtMs, models }
}

export type ModelListingPort = () => Promise<ModelListing>

/** Wraps a catalog probe (Orca's `AgentModelCatalogProbe`, or the Claude one) as a never-rejecting port. */
export function modelListingPortFromProbe(deps: {
  probe: (accountHomePath: string) => Promise<CatalogProbeSuccess>
  resolveAccountHome: () => Promise<string>
  now: () => number
}): ModelListingPort {
  return async () => {
    try {
      const home = await deps.resolveAccountHome()
      const success = await deps.probe(home)
      return listingFromCatalogSuccess(success, deps.now())
    } catch {
      return { ok: false, observedAtMs: deps.now() }
    }
  }
}

/** Wraps `discoverModelsLocal` for agy as a never-rejecting port. */
export function modelListingPortFromDiscovery(deps: {
  discover: () => Promise<DiscoverCommitMessageModelsResult>
  now: () => number
}): ModelListingPort {
  return async () => {
    try {
      return listingFromDiscovery(await deps.discover(), deps.now())
    } catch {
      return { ok: false, observedAtMs: deps.now() }
    }
  }
}

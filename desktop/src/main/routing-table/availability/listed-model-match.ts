import type { ListedModel, ModelListing } from './model-listing'

export type ModelMatch =
  | { readonly kind: 'listing_unavailable' }
  | { readonly kind: 'not_listed' }
  | {
      readonly kind: 'matched'
      /** Every row that names the model; a level must hold on all of them. */
      readonly rows: readonly ListedModel[]
      readonly matchedBy: 'id' | 'resolvedModel'
    }

/**
 * Exact match of a pinned id against a listing. A failed or empty listing is never evidence, so it
 * can never admit a model (unlike Orca's picker, which admits everything from an empty list).
 */
export function matchListedModel(
  listing: ModelListing,
  modelId: string,
  options: { readonly matchResolvedModel: boolean }
): ModelMatch {
  if (!listing.ok || listing.models.length === 0) {
    return { kind: 'listing_unavailable' }
  }
  const rows = listing.models.filter(
    (row) => row.id === modelId || (options.matchResolvedModel && row.resolvedModel === modelId)
  )
  if (rows.length === 0) {
    return { kind: 'not_listed' }
  }
  return {
    kind: 'matched',
    rows,
    matchedBy: rows.some((row) => row.id === modelId) ? 'id' : 'resolvedModel'
  }
}

/** The efforts every matching row lists. */
export function commonEfforts(rows: readonly ListedModel[]): readonly string[] {
  const [first, ...rest] = rows
  if (first === undefined) {
    return []
  }
  return first.efforts.filter((effort) => rest.every((row) => row.efforts.includes(effort)))
}

/**
 * Null when no model in the whole listing carries effort data, which is what an old CLI that predates
 * effort listing looks like; a single model without effort control (Haiku 4.5) is not that.
 */
export function commonListedEfforts(
  rows: readonly ListedModel[],
  listing: ModelListing
): readonly string[] | null {
  if (!listing.ok || listing.models.every((row) => row.efforts.length === 0)) {
    return null
  }
  return commonEfforts(rows)
}

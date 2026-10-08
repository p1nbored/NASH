import { modelPinViolation } from '../../../shared/routing-table/model-pin-policy'
import { matchListedModel } from './listed-model-match'
import type { ListedModel, ModelListing } from './model-listing'
import type { CheckOutcome } from './route-availability-types'

export type ModelCheck = {
  readonly outcome: CheckOutcome
  /** The listing rows that name the model; null unless the check passed. */
  readonly rows: readonly ListedModel[] | null
}

export type ModelCheckOptions = {
  /** Claude only: a pinned full id may match a listed alias through its resolved model. */
  readonly matchResolvedModel: boolean
}

function excluded(violation: string): ModelCheck {
  return {
    outcome: { check: 'model', result: 'fail', reason: 'model_excluded', evidence: { violation } },
    rows: null
  }
}

/**
 * The model check shared by all targets: the pin policy first (alias, rejected slug), then an
 * exact match in the listing. Nothing here substitutes another model for the pinned one.
 */
export function checkModel(
  model: string,
  listing: ModelListing,
  options: ModelCheckOptions
): ModelCheck {
  const idViolation = modelPinViolation(model)
  if (idViolation !== null) {
    return excluded(idViolation)
  }
  const match = matchListedModel(listing, model, options)
  if (match.kind === 'listing_unavailable') {
    return {
      outcome: { check: 'model', result: 'unobserved', reason: 'model_list_unavailable' },
      rows: null
    }
  }
  if (match.kind === 'not_listed') {
    return { outcome: { check: 'model', result: 'fail', reason: 'model_not_listed' }, rows: null }
  }
  return {
    outcome: { check: 'model', result: 'pass', evidence: { matchedBy: match.matchedBy } },
    rows: match.rows
  }
}

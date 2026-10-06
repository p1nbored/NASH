import type { ValidationReviewer } from './routing-table-schema'

export type ValidationReviewerSelection =
  | { readonly ok: true; readonly reviewer: ValidationReviewer }
  | { readonly ok: false; readonly reason: 'no_independent_reviewer' | 'work_model_unknown' }

function sameModel(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/**
 * D-017: the first reviewer whose model differs from the model that did the work. None means the
 * validation is inconclusive. An unknown work model fails closed, because independence cannot be shown.
 * Callers pass the concrete model id, with `inherit` already resolved to the coordinator's model.
 */
export function selectValidationReviewer(
  reviewers: readonly ValidationReviewer[],
  workModel: string | null | undefined
): ValidationReviewerSelection {
  if (workModel === null || workModel === undefined || workModel.trim() === '') {
    return { ok: false, reason: 'work_model_unknown' }
  }
  const reviewer = reviewers.find((candidate) => !sameModel(candidate.model, workModel))
  return reviewer ? { ok: true, reviewer } : { ok: false, reason: 'no_independent_reviewer' }
}

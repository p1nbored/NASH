import { modelPinViolation } from '../../../shared/routing-table/model-pin-policy'
import type { RouteSubject } from './route-availability-types'
import { authQuotaChecksOf } from './route-auth-quota-checks'
import type { RouteCheckResult, RouteObservations } from './route-check-observations'
import { cliCheckOf } from './route-cli-detection-check'
import { mapAgyEffort, reasoningCheckOf } from './route-effort-mapping'
import { checkModel } from './route-model-check'

/**
 * Gemini 4 stays excluded by label as well as by id: agy stores and lists display names, and an
 * id need not contain the family name. Only the family rule applies to a label.
 */
function labelViolation(label: string): string | null {
  return modelPinViolation(label) === 'model_family_excluded' ? 'label' : null
}

/** agy routes: the exact id `agy models` lists, thinking carried by the variant id, no effort flag. */
export function checkAgyRoute(
  subject: RouteSubject,
  observations: RouteObservations
): RouteCheckResult {
  const model = checkModel(subject.model, observations.listing, {
    matchResolvedModel: false,
    rowViolation: (row) => labelViolation(row.label)
  })
  const mapping =
    model.rows === null
      ? null
      : mapAgyEffort({
          level: subject.reasoningLevel,
          requirement: subject.requirement,
          modelId: subject.model
        })
  return {
    checks: [
      cliCheckOf(observations.detection, 'agy'),
      model.outcome,
      ...(mapping === null ? [] : [reasoningCheckOf(mapping)]),
      ...authQuotaChecksOf('agy', observations)
    ],
    mapping
  }
}

import type { RouteBlocker } from '../../../shared/clef/clef-route-contract'
import { checkClefIntake } from '../../clef/clef-request-builder'
import type { ClefState, ClefStateInput } from '../../clef/clef-state-builder'
import { G1_ALLOWED_DATA_CLASSES, evaluateDataBoundaryGate } from './routing-gates'

export type RouteDataBoundaryResult =
  | { readonly passed: true; readonly state: ClefState }
  | {
      readonly passed: false
      readonly blocker: RouteBlocker
      /** Content-scan rule names only; matched text is never kept. */
      readonly matchedRules: readonly string[]
    }

/**
 * G1 over a TaskSpec: content scan, English prose and data class over the prose Clef would see
 * (verbatim spans masked, D-013). The scan and English verdicts come from the same checks the
 * request builder runs, so the gate and the builder cannot disagree; the gate adds the data-class
 * check. The list parameter exists so tests can prove a refusal; production uses the gate's list.
 */
export function evaluateRouteDataBoundary(
  taskSpec: ClefStateInput,
  allowedDataClasses: readonly string[] = G1_ALLOWED_DATA_CLASSES
): RouteDataBoundaryResult {
  const intake = checkClefIntake(taskSpec)
  if (!intake.ok) {
    return { passed: false, blocker: intake.blocker, matchedRules: intake.matchedRules }
  }
  const gate = evaluateDataBoundaryGate(
    { contentScan: { clean: true }, objectiveIsEnglish: true, dataClass: intake.state.data_class },
    allowedDataClasses
  )
  return gate.passed
    ? { passed: true, state: intake.state }
    : { passed: false, blocker: gate.blocker, matchedRules: [] }
}

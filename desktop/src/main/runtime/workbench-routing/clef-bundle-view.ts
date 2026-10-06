import type { ClefBundleView } from '../../../shared/clef/workbench-routing-status-view'
import {
  CLEF_BUNDLE_VALUES_AWAITING_USER_CONFIRMATION,
  CLEF_DECISION_THRESHOLDS,
  CLEF_QUESTION_BUNDLE_SHA256,
  CLEF_QUESTION_SET_VERSION,
  CLEF_TAXONOMY_VERSION
} from '../../clef/clef-question-set'
import type { ClefVerifiedProfileFileStore } from '../../clef/clef-verified-profile'

/** The question bundle this build sends Clef, as the Settings screen describes it. */
export function readClefBundleView(): ClefBundleView {
  return {
    questionSetVersion: CLEF_QUESTION_SET_VERSION,
    taxonomyVersion: CLEF_TAXONOMY_VERSION,
    sha256: CLEF_QUESTION_BUNDLE_SHA256,
    thresholds: {
      delegationTrueMin: CLEF_DECISION_THRESHOLDS.delegationTrueMin,
      delegationFalseMax: CLEF_DECISION_THRESHOLDS.delegationFalseMax,
      taskTypeMarginMin: CLEF_DECISION_THRESHOLDS.taskTypeMarginMin
    },
    awaitingUserConfirmation: [...CLEF_BUNDLE_VALUES_AWAITING_USER_CONFIRMATION]
  }
}

/**
 * The bundle hash the stored profile was verified against (its input pin), read before the pin check
 * so a profile for another bundle is still named. Null when none is stored or the file is unreadable;
 * the pin-checked source already reports a read failure, so it is not reported twice.
 */
export function readVerifiedBundleSha256(
  storedProfile: Pick<ClefVerifiedProfileFileStore, 'read'>
): string | null {
  try {
    return storedProfile.read()?.profile.schemaPins.inputSchemaSha256 ?? null
  } catch {
    return null
  }
}

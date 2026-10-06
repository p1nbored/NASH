// FIXTURE_ONLY: Clef verification views for the Settings tests. Every value is synthetic; no view
// carries a token or an account id, matching the strict renderer contracts it is parsed with.
import {
  ClefProfilePinResultSchema,
  ClefVerifyResultSchema,
  type ClefProfilePinResult,
  type ClefVerifyResult
} from '../../../../shared/clef/clef-verification-view'
import {
  WorkbenchRoutingStatusViewSchema,
  type WorkbenchRoutingStatusView
} from '../../../../shared/clef/workbench-routing-status-view'

export const FIXTURE_REPORT_SHA = 'a'.repeat(64)
export const FIXTURE_RAW_SHA = 'b'.repeat(64)
export const FIXTURE_PROFILE_HASH = 'c'.repeat(64)
/** Stands in for the question bundle hash main reports; synthetic, like every hash here. */
export const FIXTURE_BUNDLE_SHA = '6'.repeat(64)
export const FIXTURE_OTHER_BUNDLE_SHA = '5'.repeat(64)

/** The bundle main reports today: question set 2, taxonomy 2, the D-020 defaults still pending. */
export function fixtureBundle(
  overrides: Partial<WorkbenchRoutingStatusView['bundle']> = {}
): WorkbenchRoutingStatusView['bundle'] {
  return {
    questionSetVersion: 2,
    taxonomyVersion: 2,
    sha256: FIXTURE_BUNDLE_SHA,
    thresholds: { delegationTrueMin: 0.6, delegationFalseMax: 0.4, taskTypeMarginMin: 0.1 },
    awaitingUserConfirmation: ['thresholds', 'task_type_options', 'needs_delegation_criteria'],
    ...overrides
  }
}

/** A pinned profile verified against the fixture bundle; pass a hash to name another bundle. */
export function fixturePinnedProfile(
  verifiedAgainstBundleSha256: string = FIXTURE_BUNDLE_SHA
): WorkbenchRoutingStatusView['profile'] {
  return {
    present: true,
    responseModelPinned: true,
    verifiedAt: '2026-10-05T10:12:00Z',
    verifiedAgainstBundleSha256
  }
}

export function fixtureStatus(
  overrides: Partial<WorkbenchRoutingStatusView> = {}
): WorkbenchRoutingStatusView {
  return WorkbenchRoutingStatusViewSchema.parse({
    status: 'contract_unverified',
    dispatch: false,
    credentials: { tokenPresent: true, accountPresent: true, protection: 'sealed' },
    profile: {
      present: false,
      responseModelPinned: false,
      verifiedAt: null,
      verifiedAgainstBundleSha256: null
    },
    bundle: fixtureBundle(),
    latches: { authFailed: false, quotaLatchedUntil: null },
    circuit: { state: 'closed', reopensAt: null, consecutiveTransient: 0 },
    ...overrides
  })
}

function question(id: string, kind: 'choice' | 'noul', expected: number) {
  return {
    id,
    kind,
    present: true,
    answerFieldNames: ['probabilities'],
    keyCoverage: { expected, observed: expected, missing: 0, extra: 0 },
    probabilitySum: 1,
    sumDeviation: 0.0002,
    maxFractionDigits: 4,
    valuesInRange: true
  }
}

export function fixtureReported(overrides: Record<string, unknown> = {}): ClefVerifyResult {
  return ClefVerifyResultSchema.parse({
    outcome: 'reported',
    report: {
      reportVersion: 2,
      httpStatus: 200,
      rawSha256: FIXTURE_RAW_SHA,
      rawByteLength: 1_480,
      bodyKind: 'json_object',
      envelope: {
        shape: 'cf_result_wrapper',
        success: true,
        errorCount: 0,
        messageCount: 0,
        topLevelKeys: ['result', 'success', 'errors', 'messages'],
        bodyKeys: ['answers', 'model', 'usage'],
        withheldKeyCount: 0
      },
      model: { observed: '@cf/cloudflare/clef', withheld: false },
      answerKeys: { matchQuestionIds: true, missing: [], extraCount: 0 },
      optionIdEcho: 'exact',
      questions: [question('task_type', 'choice', 11), question('needs_delegation', 'noul', 2)],
      maxSumDeviation: 0.0002,
      usage: {
        inputTokens: 571,
        outputTokens: 18,
        estimatedInputTokens: 564,
        inputToEstimateRatio: 1.012
      }
    },
    reportSha256: FIXTURE_REPORT_SHA,
    pin: { pinnable: true, problems: [] },
    ...overrides
  })
}

export function fixtureCallFailed(): ClefVerifyResult {
  return ClefVerifyResultSchema.parse({
    outcome: 'call_failed',
    blocker: { reason: 'classifier_unavailable', detail: 'auth_or_account' },
    httpStatus: 401,
    attempts: 1
  })
}

export function fixturePinResult(): ClefProfilePinResult {
  return ClefProfilePinResultSchema.parse({
    pinned: true,
    profileHash: FIXTURE_PROFILE_HASH,
    verifiedAt: '2026-10-05T10:12:00Z',
    routingStatus: 'ready'
  })
}

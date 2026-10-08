import type {
  ClefProfilePinResult,
  ClefVerifyResult
} from '../../../../shared/clef/clef-verification-view'

// Text for "Copy details": versions, hashes and counts that the visible Clef text leaves out. The
// views carry only flags, counts, times and public hashes, so nothing here can hold a credential.

export function clefVerifyResultDetails(result: ClefVerifyResult): string {
  if (result.outcome === 'call_failed') {
    return [
      'outcome: call_failed',
      `blocker: ${result.blocker.reason} ${result.blocker.detail}`,
      `http_status: ${result.httpStatus ?? '-'}`,
      `attempts: ${result.attempts}`
    ].join('\n')
  }
  const { report } = result
  return [
    'outcome: reported',
    `report_version: ${report.reportVersion}`,
    `report_sha256: ${result.reportSha256}`,
    `http_status: ${report.httpStatus}`,
    `raw_bytes: ${report.rawByteLength}`,
    `raw_sha256: ${report.rawSha256}`,
    `model: ${report.model.observed ?? '-'}`,
    `answer_keys_match: ${report.answerKeys.matchQuestionIds}`,
    `answer_keys_missing: ${report.answerKeys.missing.join(', ') || '-'}`,
    `option_id_echo: ${report.optionIdEcho}`,
    `max_sum_deviation: ${report.maxSumDeviation ?? '-'}`,
    `input_tokens: ${report.usage.inputTokens ?? '-'}`,
    `estimated_input_tokens: ${report.usage.estimatedInputTokens}`,
    `output_tokens: ${report.usage.outputTokens ?? '-'}`,
    `pinnable: ${result.pin.pinnable}`,
    `problems: ${result.pin.problems.join(', ') || '-'}`
  ].join('\n')
}

export function clefPinDetails(pinned: ClefProfilePinResult): string {
  return [
    `profile_hash: ${pinned.profileHash}`,
    `verified_at: ${pinned.verifiedAt}`,
    `routing_status: ${pinned.routingStatus}`
  ].join('\n')
}

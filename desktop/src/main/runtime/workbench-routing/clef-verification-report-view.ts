import {
  ClefVerificationReportViewSchema,
  type ClefVerificationReportView
} from '../../../shared/clef/clef-verification-view'
import type {
  ClefQuestionReport,
  ClefVerificationReport
} from '../../clef/clef-verification-report'

/** A server number that overflowed to infinity cannot be shown; the report keeps its own copy. */
function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null
}

function questionView(
  question: ClefQuestionReport
): ClefVerificationReportView['questions'][number] {
  return {
    id: question.id,
    kind: question.kind,
    present: question.present,
    answerFieldNames: [...question.answerFieldNames],
    keyCoverage: question.keyCoverage === null ? null : { ...question.keyCoverage },
    probabilitySum: finiteOrNull(question.probabilitySum),
    sumDeviation: finiteOrNull(question.sumDeviation),
    maxFractionDigits: question.maxFractionDigits,
    valuesInRange: question.valuesInRange
  }
}

/**
 * The renderer-safe copy of a verification report. Fields are copied one by one, never spread, so
 * a field added to the report later cannot reach the renderer until this projection names it; the
 * result is parsed through the shared strict schema the renderer uses.
 */
export function toClefVerificationReportView(
  report: ClefVerificationReport
): ClefVerificationReportView {
  return ClefVerificationReportViewSchema.parse({
    reportVersion: report.reportVersion,
    httpStatus: report.httpStatus,
    rawSha256: report.rawSha256,
    rawByteLength: report.rawByteLength,
    bodyKind: report.bodyKind,
    envelope: {
      shape: report.envelope.shape,
      success: report.envelope.success,
      errorCount: report.envelope.errorCount,
      messageCount: report.envelope.messageCount,
      topLevelKeys: [...report.envelope.topLevelKeys],
      bodyKeys: [...report.envelope.bodyKeys],
      withheldKeyCount: report.envelope.withheldKeyCount
    },
    model: { observed: report.model.observed, withheld: report.model.withheld },
    answerKeys: {
      matchQuestionIds: report.answerKeys.matchQuestionIds,
      missing: [...report.answerKeys.missing],
      extraCount: report.answerKeys.extraCount
    },
    optionIdEcho: report.optionIdEcho,
    questions: report.questions.map(questionView),
    maxSumDeviation: finiteOrNull(report.maxSumDeviation),
    usage: {
      inputTokens: report.usage.inputTokens,
      outputTokens: report.usage.outputTokens,
      estimatedInputTokens: report.usage.estimatedInputTokens,
      inputToEstimateRatio: finiteOrNull(report.usage.inputToEstimateRatio)
    }
  })
}

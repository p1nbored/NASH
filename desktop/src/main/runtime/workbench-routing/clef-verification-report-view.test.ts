import { describe, expect, it } from 'vitest'
import { ClefVerificationReportViewSchema } from '../../../shared/clef/clef-verification-view'
import { buildClefVerificationReport } from '../../clef/clef-verification-report'
import {
  FIXTURE_ONLY_RESPONSE_MODEL,
  encodeFixtureJson,
  syntheticCfEnvelope,
  syntheticClefBody
} from '../../clef/fixtures/synthetic-clef-responses.test-fixture'
import { buildClefVerificationRequest } from './clef-verification-request'
import { toClefVerificationReportView } from './clef-verification-report-view'

const { request, sent } = buildClefVerificationRequest()
const OK_BYTES = encodeFixtureJson(syntheticCfEnvelope(syntheticClefBody(request.body.questions)))

describe('toClefVerificationReportView', () => {
  it('projects every report field and passes the shared strict schema', () => {
    const report = buildClefVerificationReport({ status: 200, bytes: OK_BYTES }, sent)
    const view = toClefVerificationReportView(report)
    expect(ClefVerificationReportViewSchema.safeParse(view).success).toBe(true)
    expect(view).toEqual(report)
    expect(view.reportVersion).toBe(2)
    expect(view.model.observed).toBe(FIXTURE_ONLY_RESPONSE_MODEL)
  })

  it('names no score field, because the two-question report has none', () => {
    const view = toClefVerificationReportView(
      buildClefVerificationReport({ status: 200, bytes: OK_BYTES }, sent)
    )
    expect(Object.keys(view)).not.toContain('scoreKeyForm')
    expect(Object.keys(view)).not.toContain('scoreLegendKeyForm')
    expect(view.questions.map((question) => question.id)).toEqual(['task_type', 'needs_delegation'])
  })

  it('returns a copy, so the held report and the view never share state', () => {
    const report = buildClefVerificationReport({ status: 200, bytes: OK_BYTES }, sent)
    const view = toClefVerificationReportView(report)
    expect(view).not.toBe(report)
    expect(view.questions).not.toBe(report.questions)
    expect(view.envelope.bodyKeys).not.toBe(report.envelope.bodyKeys)
  })

  it('reports a body that is not JSON', () => {
    const report = buildClefVerificationReport(
      { status: 200, bytes: new TextEncoder().encode('<html>not json</html>') },
      sent
    )
    const view = toClefVerificationReportView(report)
    expect(view.bodyKind).toBe('not_json')
    expect(view.envelope.shape).toBe('unrecognized')
  })

  // Why: a server number such as 1e308 sums to Infinity, which no strict finite field can hold.
  it('drops a non-finite number instead of failing after the call was paid for', () => {
    const body = syntheticClefBody(request.body.questions)
    const taskType = body.answers.task_type
    const probabilities: Record<string, number> = Object.fromEntries(
      Object.keys(request.body.questions.task_type.criteria).map((id) => [id, 0])
    )
    const huge = {
      ...taskType,
      probabilities: { ...probabilities, needs_clarification: 1e308, high_quality_writing: 1e308 }
    }
    const bytes = encodeFixtureJson(
      syntheticCfEnvelope({ ...body, answers: { ...body.answers, task_type: huge } })
    )
    const report = buildClefVerificationReport({ status: 200, bytes }, sent)
    const view = toClefVerificationReportView(report)
    expect(ClefVerificationReportViewSchema.safeParse(view).success).toBe(true)
    const taskTypeReport = view.questions.find((question) => question.id === 'task_type')
    expect(taskTypeReport?.probabilitySum).toBeNull()
    expect(taskTypeReport?.sumDeviation).toBeNull()
    expect(view.maxSumDeviation).toBeNull()
  })
})

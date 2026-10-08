import { describe, expect, it } from 'vitest'
import { hasSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import {
  ATTEMPT_NOTICE_BODY_MAX_CHARS,
  AttemptNoticeSchema
} from '../orchestration/db/app-attempt-input'
import { buildDecisionNotice, decisionResultSummary } from './validation-decision-notice'

// FIXTURE_ONLY: a synthetic task; no mailbox is touched.
const TASK = 'task_0123456789ab'

describe('validation decision notice', () => {
  it.each([
    ['waive', 'waived', 'completed'],
    ['reject', 'rejected', 'failed']
  ] as const)('reports the %s outcome to the primary', (decision, past, status) => {
    const filed = buildDecisionNotice({ taskId: TASK, decision, by: 'desktop_user' })
    expect(filed.subject).toBe(`Validation ${past} for task ${TASK}`)
    expect(filed.body).toBe(
      `The inconclusive validation of task \`${TASK}\` was ${past} by the user, so the task is ${status}.`
    )
  })

  it('names who decided in the notice', () => {
    const byUser =
      buildDecisionNotice({ taskId: TASK, decision: 'waive', by: 'desktop_user' }).body ?? ''
    const byDot = buildDecisionNotice({ taskId: TASK, decision: 'waive', by: 'dot' }).body ?? ''
    expect(byDot).toContain('was waived from dot')
    expect(byUser.replace('by the user', 'X')).toBe(byDot.replace('from dot', 'X'))
  })

  it('stays one bounded English notice with no secret shape, as the store requires', () => {
    for (const decision of ['waive', 'reject'] as const) {
      const filed = buildDecisionNotice({ taskId: TASK, decision, by: 'dot' })
      expect(AttemptNoticeSchema.safeParse(filed).success).toBe(true)
      expect((filed.body ?? '').length).toBeLessThanOrEqual(ATTEMPT_NOTICE_BODY_MAX_CHARS)
      expect(hasSecretLikeText(`${filed.subject} ${filed.body}`)).toBe(false)
    }
  })

  it('records a short result line that names the decider in words', () => {
    expect(decisionResultSummary('waive', 'desktop_user')).toBe('Validation waived by the user.')
    expect(decisionResultSummary('reject', 'desktop_user')).toBe('Validation rejected by the user.')
    expect(decisionResultSummary('waive', 'dot')).toBe('Validation waived from dot.')
  })
})

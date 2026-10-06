import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DOT_VALIDATION_DECIDE_OUTCOMES,
  DOT_VALIDATION_REASONS,
  DOT_VALIDATION_SETTLED_OUTCOMES,
  DOT_VALIDATION_SUMMARY_MAX_CHARS,
  DOT_VALIDATION_TITLE_MAX_CHARS,
  DotValidationDecideParamsV3,
  DotValidationDecideResultV3Schema,
  DotValidationSettledSchema,
  DotValidationsListParamsV3,
  DotValidationsListResultV3Schema,
  DotValidationViewSchema
} from './dot-ingress-validation'

const REQUEST_ID = '00000000-0000-4000-8000-000000000001'
const DECISION_ID = '00000000-0000-4000-8000-000000000009'
const VALIDATION_ID = 'validation_0b6c1f4e-7d0a-4c55-9a35-1f2e3d4c5b6a'
const TIME = '2026-10-06T08:00:00.000Z'

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    validationId: VALIDATION_ID,
    dotRequestId: REQUEST_ID,
    title: 'Summarize the open issues',
    reason: 'primary_did_task',
    summary: 'Listed four open issues and their owners.',
    summaryWithheld: false,
    createdAt: TIME,
    ...overrides
  }
}

function decideResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 3,
    decisionId: DECISION_ID,
    validationId: VALIDATION_ID,
    dotRequestId: REQUEST_ID,
    outcome: 'decided',
    decidedAt: TIME,
    duplicate: false,
    ...overrides
  }
}

describe('dot validation decisions (contract version 3)', () => {
  it('names a fixed reason vocabulary and the decide and settled outcomes', () => {
    expect([...DOT_VALIDATION_REASONS]).toEqual([
      'claim_only',
      'primary_did_task',
      'report_missing',
      'review_unavailable',
      'review_inconclusive',
      'checks_inconclusive',
      'other'
    ])
    expect([...DOT_VALIDATION_DECIDE_OUTCOMES]).toEqual(['decided', 'already_decided', 'closed'])
    expect([...DOT_VALIDATION_SETTLED_OUTCOMES]).toEqual(['waived', 'rejected', 'closed'])
    expect(DOT_VALIDATION_TITLE_MAX_CHARS).toBe(200)
    expect(DOT_VALIDATION_SUMMARY_MAX_CHARS).toBe(500)
  })

  it('accepts exactly the user-approved fields: title, reason, summary (U32 exception)', () => {
    expect(DotValidationViewSchema.parse(view())).toEqual(view())
    for (const extra of ['path', 'worktree', 'branch', 'baseCommit', 'model', 'runId', 'taskId']) {
      expect(DotValidationViewSchema.safeParse(view({ [extra]: 'x' })).success, extra).toBe(false)
    }
    expect(DotValidationViewSchema.safeParse(view({ reason: 'secret_found' })).success).toBe(false)
  })

  it('withholds the summary as null and says so, never both a summary and the flag', () => {
    expect(
      DotValidationViewSchema.safeParse(view({ summary: null, summaryWithheld: true })).success
    ).toBe(true)
    expect(
      DotValidationViewSchema.safeParse(view({ summary: null, summaryWithheld: false })).success
    ).toBe(true)
    expect(DotValidationViewSchema.safeParse(view({ summaryWithheld: true })).success).toBe(false)
  })

  it('bounds title and summary in code points and refuses controls, bidi and line separators', () => {
    const title = 'é'.repeat(DOT_VALIDATION_TITLE_MAX_CHARS)
    expect(DotValidationViewSchema.safeParse(view({ title })).success).toBe(true)
    expect(DotValidationViewSchema.safeParse(view({ title: `${title}é` })).success).toBe(false)
    const emoji = '😀'.repeat(DOT_VALIDATION_SUMMARY_MAX_CHARS)
    expect(DotValidationViewSchema.safeParse(view({ summary: emoji })).success).toBe(true)
    expect(DotValidationViewSchema.safeParse(view({ summary: `${emoji}😀` })).success).toBe(false)
    for (const bad of ['a\nb', 'a\u0007b', 'a\u2028b', 'a\u2029b', 'a\u202Eb', 'a\u2066b', '']) {
      expect(DotValidationViewSchema.safeParse(view({ title: bad })).success, bad).toBe(false)
      expect(DotValidationViewSchema.safeParse(view({ summary: bad })).success, bad).toBe(false)
    }
  })

  it('pins every request and result to version 3 and keeps them strict', () => {
    const list = { contractVersion: 3, dotRequestId: REQUEST_ID, limit: 10 }
    expect(DotValidationsListParamsV3.parse({ contractVersion: 3 })).toEqual({
      contractVersion: 3,
      limit: 50
    })
    expect(DotValidationsListParamsV3.safeParse(list).success).toBe(true)
    expect(DotValidationsListParamsV3.safeParse({ ...list, contractVersion: 2 }).success).toBe(
      false
    )
    expect(DotValidationsListParamsV3.safeParse({ ...list, origin: 'desktop' }).success).toBe(false)
    const decide = {
      contractVersion: 3,
      decisionId: DECISION_ID,
      validationId: VALIDATION_ID,
      decision: 'waive'
    }
    expect(DotValidationDecideParamsV3.safeParse(decide).success).toBe(true)
    for (const bad of [
      { ...decide, decision: 'pass' },
      { ...decide, decisionId: 'not-a-uuid' },
      { ...decide, by: 'desktop_user' },
      { ...decide, contractVersion: 2 }
    ]) {
      expect(DotValidationDecideParamsV3.safeParse(bad).success).toBe(false)
    }
    expect(
      DotValidationsListResultV3Schema.safeParse({
        contractVersion: 3,
        validations: [view()],
        hasMore: false
      }).success
    ).toBe(true)
  })

  it('has a decision time exactly when the decision was not closed', () => {
    expect(DotValidationDecideResultV3Schema.safeParse(decideResult()).success).toBe(true)
    expect(
      DotValidationDecideResultV3Schema.safeParse(
        decideResult({ outcome: 'already_decided', duplicate: true })
      ).success
    ).toBe(true)
    expect(
      DotValidationDecideResultV3Schema.safeParse(
        decideResult({ outcome: 'closed', decidedAt: null })
      ).success
    ).toBe(true)
    expect(
      DotValidationDecideResultV3Schema.safeParse(decideResult({ outcome: 'closed' })).success
    ).toBe(false)
    expect(
      DotValidationDecideResultV3Schema.safeParse(decideResult({ decidedAt: null })).success
    ).toBe(false)
    expect(
      DotValidationDecideResultV3Schema.safeParse(decideResult({ outcome: 'not_found' })).success
    ).toBe(false)
  })

  it('describes a settled decision by its outcome and time only', () => {
    const settled = { validationId: VALIDATION_ID, outcome: 'waived', decidedAt: TIME }
    expect(DotValidationSettledSchema.parse(settled)).toEqual(settled)
    expect(
      DotValidationSettledSchema.safeParse({ ...settled, outcome: 'closed', decidedAt: null })
        .success
    ).toBe(true)
    expect(DotValidationSettledSchema.safeParse({ ...settled, decidedAt: null }).success).toBe(
      false
    )
    expect(DotValidationSettledSchema.safeParse({ ...settled, title: 'x' }).success).toBe(false)
  })

  it('converts every schema to JSON Schema with the line pattern kept', () => {
    const json = JSON.stringify(z.toJSONSchema(DotValidationViewSchema))
    expect(json).toContain('\\\\p{Cc}')
    for (const schema of [
      DotValidationsListParamsV3,
      DotValidationsListResultV3Schema,
      DotValidationDecideParamsV3,
      DotValidationDecideResultV3Schema,
      DotValidationSettledSchema
    ]) {
      expect(() => z.toJSONSchema(schema)).not.toThrow()
    }
  })
})

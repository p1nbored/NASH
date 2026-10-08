import { describe, expect, it } from 'vitest'
import { parseReviewOutput, reviewChecks } from './model-review-verdict'

const review = (value: unknown): string => JSON.stringify(value)
const PASS = {
  verdict: 'pass',
  criteria: [
    { index: 1, met: true, reason: 'The report names every top-level folder.' },
    { index: 2, met: true, reason: 'No source file was changed.' }
  ],
  summary: 'The work meets both criteria.'
}

describe('model review verdict', () => {
  it('accepts the exact shape, one entry per acceptance criterion in order', () => {
    expect(parseReviewOutput(review(PASS), 2)).toEqual({ ok: true, review: PASS })
  })

  it('tolerates one surrounding json code fence and nothing else', () => {
    expect(parseReviewOutput(`\`\`\`json\n${review(PASS)}\n\`\`\``, 2)).toMatchObject({ ok: true })
    expect(parseReviewOutput(`Here it is: ${review(PASS)}`, 2)).toMatchObject({ ok: false })
  })

  it('refuses extra keys, missing keys, wrong types and a wrong criteria count or order', () => {
    const variants: unknown[] = [
      { ...PASS, confidence: 0.9 },
      { verdict: 'pass', criteria: PASS.criteria },
      { ...PASS, verdict: 'approved' },
      { ...PASS, criteria: [PASS.criteria[0]] },
      { ...PASS, criteria: [PASS.criteria[1], PASS.criteria[0]] },
      { ...PASS, criteria: [{ ...PASS.criteria[0], index: 1.5 }, PASS.criteria[1]] },
      { ...PASS, criteria: [{ ...PASS.criteria[0], extra: 1 }, PASS.criteria[1]] }
    ]
    for (const variant of variants) {
      expect(parseReviewOutput(review(variant), 2)).toMatchObject({ ok: false })
    }
    expect(parseReviewOutput('not json', 2)).toMatchObject({ ok: false })
  })

  it('refuses a verdict its own criteria contradict', () => {
    const unmet = [{ ...PASS.criteria[0], met: false }, PASS.criteria[1]]
    expect(parseReviewOutput(review({ ...PASS, criteria: unmet }), 2)).toMatchObject({ ok: false })
    expect(parseReviewOutput(review({ ...PASS, verdict: 'fail' }), 2)).toMatchObject({ ok: false })
    expect(
      parseReviewOutput(review({ ...PASS, verdict: 'inconclusive', criteria: unmet }), 2)
    ).toMatchObject({ ok: false })
    expect(
      parseReviewOutput(review({ ...PASS, verdict: 'fail', criteria: unmet }), 2)
    ).toMatchObject({
      ok: true
    })
  })

  it('refuses reasons that are not English, not one line, empty or too long', () => {
    const withReason = (reason: string) =>
      review({ ...PASS, criteria: [{ ...PASS.criteria[0], reason }, PASS.criteria[1]] })
    for (const reason of ['报告已存在。', 'two\nlines', '', 'x'.repeat(301)]) {
      expect(parseReviewOutput(withReason(reason), 2)).toMatchObject({ ok: false })
    }
  })

  it('turns a review into one overall check and one check per criterion', () => {
    const undecided = {
      verdict: 'inconclusive',
      criteria: [
        { index: 1, met: true, reason: 'Met.' },
        { index: 2, met: null, reason: 'The result does not show this.' }
      ],
      summary: 'One criterion cannot be judged from the evidence.'
    }
    const parsed = parseReviewOutput(review(undecided), 2)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(reviewChecks(parsed.review)).toEqual([
      {
        kind: 'model_review',
        status: 'inconclusive',
        note: 'One criterion cannot be judged from the evidence.'
      },
      { kind: 'review_criterion', status: 'pass', note: 'Criterion 1: Met.' },
      {
        kind: 'review_criterion',
        status: 'inconclusive',
        note: 'Criterion 2: The result does not show this.'
      }
    ])
  })
})

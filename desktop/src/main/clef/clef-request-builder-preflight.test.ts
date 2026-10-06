import { describe, expect, it } from 'vitest'
import {
  CLEF_MAX_BODY_BYTES,
  CLEF_MAX_ESTIMATED_INPUT_TOKENS,
  estimateClefInputTokens,
  preflightClefRequest
} from './clef-request-builder-preflight'
import { buildClassifierQuestions, type ClefQuestion } from './clef-question-set'

const REJECTED = { reason: 'classifier_unavailable', detail: 'request_rejected' }
const ESTIMATE = { reason: 'classifier_unavailable', detail: 'estimate_exceeded' }

const questions = buildClassifierQuestions()

function preflight(
  overrides: Partial<{
    questions: Readonly<Record<string, ClefQuestion>>
    bodyByteLength: number
    estimatedInputTokens: number
  }>
) {
  return preflightClefRequest({
    questions,
    bodyByteLength: 1_000,
    estimatedInputTokens: 500,
    ...overrides
  })
}

function choiceWith(count: number): ClefQuestion {
  return {
    type: 'choice',
    instructions: 'Pick one.',
    criteria: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`option_${i}`, `Option ${i}.`])
    )
  }
}

function noulWith(yes: string, no: string): ClefQuestion {
  return { type: 'noul', instructions: 'Yes?', criteria: { true: yes, false: no } }
}

describe('preflightClefRequest', () => {
  it('accepts the classifier question set within limits', () => {
    expect(preflight({})).toBeNull()
  })

  it('accepts the limits exactly', () => {
    const many = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`q${i}`, choiceWith(2)]))
    expect(preflight({ questions: many })).toBeNull()
    expect(preflight({ questions: { a: choiceWith(255) } })).toBeNull()
    expect(preflight({ questions: { a: noulWith('yes', 'no') } })).toBeNull()
    expect(preflight({ bodyByteLength: CLEF_MAX_BODY_BYTES })).toBeNull()
    expect(preflight({ estimatedInputTokens: CLEF_MAX_ESTIMATED_INPUT_TOKENS })).toBeNull()
  })

  it.each([
    ['no questions', {}],
    [
      '65 questions',
      Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`q${i}`, choiceWith(2)]))
    ],
    ['a question id outside the charset', { 'task type': choiceWith(2) }],
    ['a question id over 100 characters', { ['q'.repeat(101)]: choiceWith(2) }],
    ['blank instructions', { a: { ...choiceWith(2), instructions: '  ' } }],
    ['a choice with one option', { a: choiceWith(1) }],
    ['a choice with 256 options', { a: choiceWith(256) }],
    [
      'an option id outside the charset',
      { a: { type: 'choice', instructions: 'Pick.', criteria: { 'a b': 'A.', c: 'C.' } } }
    ],
    ['blank noul criteria', { a: noulWith('yes', '') }],
    ['blank true noul criteria', { a: noulWith(' ', 'no') }]
  ] satisfies [string, Readonly<Record<string, ClefQuestion>>][])(
    'rejects %s with no call',
    (_label, bad) => {
      expect(preflight({ questions: bad })).toEqual(REJECTED)
    }
  )

  it('rejects a body over 64 KiB', () => {
    expect(CLEF_MAX_BODY_BYTES).toBe(65_536)
    expect(preflight({ bodyByteLength: CLEF_MAX_BODY_BYTES + 1 })).toEqual(REJECTED)
  })

  it('rejects an estimate over 12,000 tokens as estimate_exceeded', () => {
    expect(CLEF_MAX_ESTIMATED_INPUT_TOKENS).toBe(12_000)
    expect(preflight({ estimatedInputTokens: CLEF_MAX_ESTIMATED_INPUT_TOKENS + 1 })).toEqual(
      ESTIMATE
    )
  })

  it('reports a structural failure before the estimate', () => {
    expect(preflight({ questions: { a: choiceWith(1) }, estimatedInputTokens: 99_999 })).toEqual(
      REJECTED
    )
  })
})

describe('estimateClefInputTokens', () => {
  it('counts state and question JSON at four characters per token, rounded up', () => {
    const state = { objective: 'abc', data_class: 'agent_task_spec' } as const
    const chars = JSON.stringify(state).length + JSON.stringify(questions).length
    expect(estimateClefInputTokens(state, questions)).toBe(Math.ceil(chars / 4))
  })

  it('grows with option text', () => {
    const state = { objective: 'abc', data_class: 'agent_task_spec' } as const
    const longer = {
      ...questions,
      task_type: {
        ...questions.task_type,
        criteria: { ...questions.task_type.criteria, software_engineering: 'x'.repeat(400) }
      }
    }
    expect(estimateClefInputTokens(state, longer)).toBeGreaterThan(
      estimateClefInputTokens(state, questions) + 50
    )
  })
})

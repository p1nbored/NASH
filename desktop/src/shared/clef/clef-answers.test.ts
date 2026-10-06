import { describe, expect, it } from 'vitest'
import {
  CLEF_CLASSIFIER_QUESTION_IDS,
  CLEF_CLASSIFIER_QUESTION_KINDS,
  CLEF_IDENTIFIER_PATTERN,
  CLEF_QUESTION_KINDS,
  ClefProbabilitiesSchema,
  NEEDS_CLARIFICATION_OPTION_ID,
  ValidatedClefAnswersSchema,
  type ValidatedClefAnswers
} from './clef-answers'

const answers = {
  taskType: {
    choice: 'software_engineering',
    probabilities: {
      coordinator_reasoning: 0.05,
      software_engineering: 0.85,
      needs_clarification: 0.1
    }
  },
  needsDelegation: { value: 0.8 },
  providerConfidence: { task_type: 0.8, needs_delegation: null },
  responseModel: '@cf/cloudflare/clef',
  usage: { inputTokens: 1_840, outputTokens: 96 }
} satisfies ValidatedClefAnswers

function withChange(change: Record<string, unknown>): Record<string, unknown> {
  return { ...answers, ...change }
}

describe('classifier question contract', () => {
  it('pins the two question kinds and the send order', () => {
    expect(CLEF_QUESTION_KINDS).toEqual(['choice', 'noul'])
    expect(CLEF_CLASSIFIER_QUESTION_IDS).toEqual(['task_type', 'needs_delegation'])
    expect(CLEF_CLASSIFIER_QUESTION_KINDS).toEqual({
      task_type: 'choice',
      needs_delegation: 'noul'
    })
    expect(Object.isFrozen(CLEF_CLASSIFIER_QUESTION_KINDS)).toBe(true)
    expect(NEEDS_CLARIFICATION_OPTION_ID).toBe('needs_clarification')
  })

  it('owns the documented Clef identifier charset', () => {
    expect(CLEF_IDENTIFIER_PATTERN.test('software_engineering')).toBe(true)
    expect(CLEF_IDENTIFIER_PATTERN.test('two words')).toBe(false)
    expect(CLEF_IDENTIFIER_PATTERN.test('a'.repeat(101))).toBe(false)
  })
})

describe('ValidatedClefAnswersSchema', () => {
  it('accepts a normalized answer set unchanged', () => {
    expect(ValidatedClefAnswersSchema.parse(answers)).toEqual(answers)
  })

  it('rejects unknown fields, including the removed score and route answers', () => {
    expect(ValidatedClefAnswersSchema.safeParse(withChange({ rationale: 'x' })).success).toBe(false)
    expect(
      ValidatedClefAnswersSchema.safeParse(
        withChange({ needsDelegation: { value: 0.9, confidence: 0.4 } })
      ).success
    ).toBe(false)
    expect(
      ValidatedClefAnswersSchema.safeParse(
        withChange({ difficulty: { score: 2, levels: 5, probabilities: { '0': 1 } } })
      ).success
    ).toBe(false)
    expect(
      ValidatedClefAnswersSchema.safeParse(
        withChange({ route: { choice: 'a', probabilities: { a: 1 } } })
      ).success
    ).toBe(false)
  })

  it('requires both classifier answers', () => {
    const { needsDelegation: _needsDelegation, ...withoutDelegation } = answers
    const { taskType: _taskType, ...withoutTaskType } = answers
    expect(ValidatedClefAnswersSchema.safeParse(withoutDelegation).success).toBe(false)
    expect(ValidatedClefAnswersSchema.safeParse(withoutTaskType).success).toBe(false)
  })

  it.each([
    [
      'probability above 1',
      { taskType: { choice: 'software_engineering', probabilities: { software_engineering: 1.2 } } }
    ],
    [
      'negative probability',
      {
        taskType: { choice: 'software_engineering', probabilities: { software_engineering: -0.1 } }
      }
    ],
    [
      'NaN probability',
      {
        taskType: {
          choice: 'software_engineering',
          probabilities: { software_engineering: Number.NaN }
        }
      }
    ],
    [
      'choice outside its probability keys',
      { taskType: { choice: 'high_quality_writing', probabilities: { software_engineering: 1 } } }
    ],
    ['empty probabilities', { taskType: { choice: 'software_engineering', probabilities: {} } }],
    [
      'option key outside the charset',
      {
        taskType: {
          choice: 'software_engineering',
          probabilities: { software_engineering: 0.5, 'two words': 0.5 }
        }
      }
    ],
    ['noul above 1', { needsDelegation: { value: 1.01 } }],
    ['negative noul', { needsDelegation: { value: -0.01 } }],
    ['infinite noul', { needsDelegation: { value: Number.POSITIVE_INFINITY } }],
    ['negative usage', { usage: { inputTokens: -1, outputTokens: 0 } }],
    ['fractional usage', { usage: { inputTokens: 10, outputTokens: 0.5 } }],
    ['confidence above 1', { providerConfidence: { task_type: 2 } }],
    ['blank response model', { responseModel: '' }],
    ['response model with whitespace', { responseModel: 'clef model' }]
  ])('rejects %s', (_label, change) => {
    expect(ValidatedClefAnswersSchema.safeParse(withChange(change)).success).toBe(false)
  })
})

describe('ClefProbabilitiesSchema', () => {
  it('rejects a __proto__ key instead of silently dropping it', () => {
    const parsed: unknown = JSON.parse('{"__proto__": 0.5, "module": 0.5}')
    expect(ClefProbabilitiesSchema.safeParse(parsed).success).toBe(false)
    const confidence: unknown = JSON.parse('{"__proto__": 0.5}')
    expect(
      ValidatedClefAnswersSchema.safeParse(withChange({ providerConfidence: confidence })).success
    ).toBe(false)
  })

  it('rejects a non-object record', () => {
    expect(ClefProbabilitiesSchema.safeParse(null).success).toBe(false)
    expect(ClefProbabilitiesSchema.safeParse([0.5, 0.5]).success).toBe(false)
  })

  it('rejects more than 255 options', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [`option_${index}`, 0])
    )
    expect(ClefProbabilitiesSchema.safeParse(tooMany).success).toBe(false)
  })
})

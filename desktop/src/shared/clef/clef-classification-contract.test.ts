import { describe, expect, it } from 'vitest'
import { ROUTING_TASK_TYPES } from '../routing-table/routing-table-taxonomy'
import {
  CLASSIFICATION_OUTCOMES,
  ClassificationResultSchema,
  RECORDED_CLASSIFICATION_ANSWER_KEYS,
  RecordedClassificationAnswersSchema
} from './clef-classification-contract'

describe('ClassificationResultSchema', () => {
  it('accepts every routable task type with either delegation answer', () => {
    for (const taskType of ROUTING_TASK_TYPES) {
      for (const needsDelegation of [true, false]) {
        const result = { needsDelegation, taskType }
        expect(ClassificationResultSchema.parse(result)).toEqual(result)
      }
    }
  })

  it('refuses needs_clarification, unknown types and any target, model or effort field', () => {
    expect(
      ClassificationResultSchema.safeParse({
        needsDelegation: true,
        taskType: 'needs_clarification'
      }).success
    ).toBe(false)
    expect(
      ClassificationResultSchema.safeParse({ needsDelegation: true, taskType: 'planning' }).success
    ).toBe(false)
    for (const extra of ['target', 'model', 'effort', 'route', 'difficulty']) {
      expect(
        ClassificationResultSchema.safeParse({
          needsDelegation: false,
          taskType: 'software_engineering',
          [extra]: 'x'
        }).success
      ).toBe(false)
    }
    expect(
      ClassificationResultSchema.safeParse({
        needsDelegation: 'yes',
        taskType: 'software_engineering'
      }).success
    ).toBe(false)
  })
})

describe('classification outcomes', () => {
  it('replace routed with classified and keep the other three', () => {
    expect(CLASSIFICATION_OUTCOMES).toEqual([
      'classified',
      'blocked',
      'invalid_output',
      'discarded_after_cancel'
    ])
  })
})

describe('RecordedClassificationAnswersSchema', () => {
  const recorded = {
    taskType: 'software_engineering',
    needsDelegation: 0.75,
    probabilities: {
      task_type: { software_engineering: 0.9, needs_clarification: 0.1 }
    },
    providerConfidence: { status: 'not_used', values: { task_type: 0.7, needs_delegation: null } }
  }
  const unanswered = Object.fromEntries(
    RECORDED_CLASSIFICATION_ANSWER_KEYS.map((key) => [key, null])
  )

  it('lists the answer columns', () => {
    expect(RECORDED_CLASSIFICATION_ANSWER_KEYS).toEqual([
      'taskType',
      'needsDelegation',
      'probabilities',
      'providerConfidence'
    ])
  })

  it('accepts a full answer projection and an all-null one', () => {
    expect(RecordedClassificationAnswersSchema.parse(recorded)).toEqual(recorded)
    expect(RecordedClassificationAnswersSchema.parse(unanswered)).toEqual(unanswered)
  })

  it.each([
    ['confidence not labeled not_used', { providerConfidence: { status: 'used', values: {} } }],
    ['a delegation probability above 1', { needsDelegation: 1.5 }],
    ['a task type outside the charset', { taskType: 'two words' }],
    ['a probability outside [0, 1]', { probabilities: { task_type: { a: 1.5 } } }],
    [
      'more than 64 questions',
      {
        probabilities: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`question_${index}`, { a: 1 }])
        )
      }
    ],
    ['a retired column', { difficultyScore: 2 }],
    ['an extra column', { rationale: 'x' }]
  ])('rejects %s', (_label, change) => {
    expect(RecordedClassificationAnswersSchema.safeParse({ ...recorded, ...change }).success).toBe(
      false
    )
  })
})

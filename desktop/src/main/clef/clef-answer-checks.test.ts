import { describe, expect, it } from 'vitest'
import type { ClefClassifierQuestionId } from '../../shared/clef/clef-answers'
import { RouteBlockerSchema } from '../../shared/clef/clef-route-contract'
import { CLEF_RESPONSE_SHAPE_DETAIL, checkClassifierAnswers } from './clef-answer-checks'
import { buildClefRequest } from './clef-request-builder'
import { syntheticClefBody } from './fixtures/synthetic-clef-responses.test-fixture'

const built = buildClefRequest({ objective: 'Review the current change and report findings.' })
if (!built.ok) {
  throw new Error('fixture request must build')
}
const { questions } = built.request.body
const TOLERANCE = 1e-3
const CHOICES = { task_type: 'software_engineering', needs_delegation: 0.82 }
const SCHEMA_VIOLATION = { reason: 'invalid_output', detail: 'response_schema_violation' }
const TIE = { reason: 'ambiguous', detail: 'low_margin' }

function answers() {
  return syntheticClefBody(questions, CHOICES).answers
}

function withAnswer(id: ClefClassifierQuestionId, change: Record<string, unknown>) {
  const base = answers()
  return { ...base, [id]: { ...base[id], ...change } }
}

function check(raw: unknown) {
  return checkClassifierAnswers(raw, questions, {
    optionKeyForm: 'sent_option_id',
    sumTolerance: TOLERANCE
  })
}

function blockerOf(raw: unknown) {
  const result = check(raw)
  return result.ok ? null : result.blocker
}

/** Probabilities over the eleven sent task types: 0.03 each, with the chosen one raised to 0.7. */
const taskTypeProbabilities = (overrides: Record<string, unknown>) => ({
  ...Object.fromEntries(
    Object.keys(questions.task_type.criteria).map((id) => [
      id,
      id === 'software_engineering' ? 0.7 : 0.03
    ])
  ),
  ...overrides
})

describe('checkClassifierAnswers answer set', () => {
  it('accepts consistent answers and keeps probabilities verbatim', () => {
    const result = check(answers())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.answers.taskType).toEqual({
      choice: 'software_engineering',
      probabilities: answers().task_type.probabilities
    })
    expect(result.answers.needsDelegation).toEqual({ value: 0.82 })
    expect(result.providerConfidence).toEqual({ task_type: 0.62, needs_delegation: null })
  })

  it.each([
    ['not an object', 'answers'],
    ['an array', [answers()]],
    ['null', null]
  ])('rejects answers that are %s', (_label, raw) => {
    expect(blockerOf(raw)).toEqual(SCHEMA_VIOLATION)
  })

  it('rejects a missing answer key', () => {
    const { needs_delegation: _delegation, ...withoutDelegation } = answers()
    const { task_type: _taskType, ...withoutTaskType } = answers()
    expect(blockerOf(withoutDelegation)).toEqual(SCHEMA_VIOLATION)
    expect(blockerOf(withoutTaskType)).toEqual(SCHEMA_VIOLATION)
  })

  it.each(['route', 'difficulty', 'context_scope', 'inputs_complete', 'execution_profile'])(
    'rejects an extra %s answer, since the bundle sends only two questions',
    (extra) => {
      expect(blockerOf({ ...answers(), [extra]: answers().task_type })).toEqual(SCHEMA_VIOLATION)
    }
  )

  it('rejects a __proto__ answer key instead of following it', () => {
    const raw: unknown = JSON.parse(`{"__proto__": {}, ${JSON.stringify(answers()).slice(1)}`)
    expect(blockerOf(raw)).toEqual(SCHEMA_VIOLATION)
  })

  it('rejects an answer whose type does not match its question', () => {
    expect(blockerOf(withAnswer('needs_delegation', { type: 'choice' }))).toEqual(SCHEMA_VIOLATION)
    expect(blockerOf(withAnswer('task_type', { type: undefined }))).toEqual(SCHEMA_VIOLATION)
    expect(blockerOf(withAnswer('task_type', { type: 'score' }))).toEqual(SCHEMA_VIOLATION)
    expect(blockerOf(withAnswer('task_type', { type: 'noul' }))).toEqual(SCHEMA_VIOLATION)
  })
})

describe('needs_delegation answers', () => {
  it.each([
    ['above 1', 1.01],
    ['below 0', -0.01],
    ['missing', undefined],
    ['a string', '0.5']
  ])('rejects a value %s', (_label, noul) => {
    expect(blockerOf(withAnswer('needs_delegation', { noul }))).toEqual(SCHEMA_VIOLATION)
  })

  it('accepts the bounds', () => {
    expect(check(withAnswer('needs_delegation', { noul: 0 })).ok).toBe(true)
    expect(check(withAnswer('needs_delegation', { noul: 1 })).ok).toBe(true)
  })

  it('reads only the documented noul field, never value', () => {
    expect(blockerOf(withAnswer('needs_delegation', { noul: undefined, value: 0.9 }))).toEqual(
      SCHEMA_VIOLATION
    )
  })
})

describe('task_type answers', () => {
  it('flags a choice outside the sent options as choice_outside_legal_set', () => {
    for (const choice of ['planning', 'implementation', 'codex_assistant.codex_exec']) {
      expect(blockerOf(withAnswer('task_type', { choice }))).toEqual({
        reason: 'invalid_output',
        detail: 'choice_outside_legal_set'
      })
    }
  })

  it('accepts every sent option as the choice, including needs_clarification', () => {
    for (const choice of Object.keys(questions.task_type.criteria)) {
      const probabilities = taskTypeProbabilities({
        software_engineering: 0.03,
        [choice]: 0.7
      })
      expect(check(withAnswer('task_type', { choice, probabilities })).ok).toBe(true)
    }
  })

  it.each([
    ['a missing option', { software_engineering: 0.73, high_quality_writing: undefined }],
    ['an extra option', { unknown_option: 0 }],
    ['a value above 1', { software_engineering: 1.2, high_quality_writing: -0.5 }],
    ['a negative value', { high_quality_writing: -0.05, software_engineering: 0.78 }],
    ['a non-number', { high_quality_writing: '0.03' }],
    ['a sum below tolerance', { software_engineering: 0.6 }],
    ['a sum above tolerance', { software_engineering: 0.702 }]
  ])('rejects probabilities with %s', (_label, change) => {
    const raw = withAnswer('task_type', { probabilities: taskTypeProbabilities(change) })
    expect(blockerOf(raw)).toEqual(SCHEMA_VIOLATION)
  })

  it('accepts a sum within the profile tolerance', () => {
    const raw = withAnswer('task_type', {
      probabilities: taskTypeProbabilities({ software_engineering: 0.7005 })
    })
    expect(check(raw).ok).toBe(true)
  })

  it('rejects a __proto__ probability key', () => {
    const probabilities: unknown = JSON.parse(
      `{"__proto__": 0, ${JSON.stringify(taskTypeProbabilities({})).slice(1)}`
    )
    expect(blockerOf(withAnswer('task_type', { probabilities }))).toEqual(SCHEMA_VIOLATION)
  })

  it('rejects a choice that is not the argmax', () => {
    const raw = withAnswer('task_type', {
      probabilities: taskTypeProbabilities({
        software_engineering: 0.1,
        high_quality_writing: 0.63
      })
    })
    expect(blockerOf(raw)).toEqual(SCHEMA_VIOLATION)
  })

  it('reports a tie for the top option as ambiguous / low_margin', () => {
    const raw = withAnswer('task_type', {
      probabilities: taskTypeProbabilities({
        software_engineering: 0.365,
        high_quality_writing: 0.365
      })
    })
    expect(blockerOf(raw)).toEqual(TIE)
  })

  it('reports an invalid answer ahead of a tie', () => {
    const tie = withAnswer('task_type', {
      probabilities: taskTypeProbabilities({
        software_engineering: 0.365,
        high_quality_writing: 0.365
      })
    })
    const raw = { ...tie, task_type: { ...tie.task_type, confidence: 2 } }
    expect(blockerOf(raw)).toEqual(SCHEMA_VIOLATION)
  })

  it.each([
    ['a missing confidence', { confidence: undefined }],
    ['a confidence above 1', { confidence: 1.5 }],
    ['a non-string choice', { choice: 3 }]
  ])('rejects %s', (_label, change) => {
    expect(blockerOf(withAnswer('task_type', change))).toEqual(SCHEMA_VIOLATION)
  })
})

describe('shape failures in the shared blocker contract', () => {
  it('reports shape failures with the shared response_schema_violation detail', () => {
    expect(CLEF_RESPONSE_SHAPE_DETAIL).toBe('response_schema_violation')
    expect(RouteBlockerSchema.safeParse(SCHEMA_VIOLATION).success).toBe(true)
  })
})

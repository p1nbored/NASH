import { describe, expect, it } from 'vitest'
import type { ValidatedClefAnswers } from '../../shared/clef/clef-answers'
import { ClassificationResultSchema } from '../../shared/clef/clef-classification-contract'
import { ROUTING_TASK_TYPES } from '../../shared/routing-table/routing-table-taxonomy'
import { decideClassification, type ClassificationValidation } from './clef-classification-rules'
import { CLEF_DECISION_THRESHOLDS, TASK_TYPE_OPTIONS } from './clef-question-set'

const OPTION_IDS = Object.keys(TASK_TYPE_OPTIONS)
const NEEDS_CLARIFICATION = { reason: 'missing_inputs', detail: 'needs_clarification' } as const
const LOW_MARGIN = { reason: 'ambiguous', detail: 'low_margin' } as const
const INCONSISTENT = { reason: 'ambiguous', detail: 'inconsistent_delegation' } as const

function taskTypeAnswer(choice: string, top = 0.7): ValidatedClefAnswers['taskType'] {
  const rest = (1 - top) / (OPTION_IDS.length - 1)
  return {
    choice,
    probabilities: Object.fromEntries(OPTION_IDS.map((id) => [id, id === choice ? top : rest]))
  }
}

function twoWay(first: string, top: number, second: string, next: number) {
  return { choice: first, probabilities: { [first]: top, [second]: next } }
}

function answers(change: Partial<ValidatedClefAnswers> = {}): ValidatedClefAnswers {
  return {
    taskType: taskTypeAnswer('software_engineering'),
    needsDelegation: { value: 0.8 },
    providerConfidence: { task_type: 0.7, needs_delegation: null },
    responseModel: '@cf/cloudflare/clef',
    usage: { inputTokens: 700, outputTokens: 40 },
    ...change
  }
}

function decide(change: Partial<ValidatedClefAnswers> = {}) {
  return decideClassification({ ok: true, answers: answers(change) })
}

describe('classification outcome rules', () => {
  it('classifies a delegable task as {needsDelegation: true, taskType}', () => {
    expect(decide()).toEqual({
      outcome: 'classified',
      result: { needsDelegation: true, taskType: 'software_engineering' }
    })
  })

  it('classifies every routable task type, with either delegation answer except the coordinator', () => {
    for (const taskType of ROUTING_TASK_TYPES) {
      const falseCase = decide({
        taskType: taskTypeAnswer(taskType),
        needsDelegation: { value: 0.2 }
      })
      expect(falseCase).toEqual({
        outcome: 'classified',
        result: { needsDelegation: false, taskType }
      })
      const trueCase = decide({ taskType: taskTypeAnswer(taskType) })
      expect(trueCase.outcome).toBe(taskType === 'coordinator_reasoning' ? 'blocked' : 'classified')
    }
  })

  it('returns a result of exactly two fields, with no target, model or effort', () => {
    const outcome = decide()
    expect(outcome.outcome === 'classified' && Object.keys(outcome.result)).toEqual([
      'needsDelegation',
      'taskType'
    ])
    expect(
      outcome.outcome === 'classified' &&
        ClassificationResultSchema.safeParse(outcome.result).success
    ).toBe(true)
  })

  it('rule 1: passes a validation failure through as invalid_output with its detail', () => {
    const validation: ClassificationValidation = {
      ok: false,
      blocker: { reason: 'invalid_output', detail: 'model_identity_mismatch' }
    }
    expect(decideClassification(validation)).toEqual({
      outcome: 'invalid_output',
      blocker: validation.blocker
    })
  })

  it('rule 1: keeps a validator tie as a blocked ambiguous outcome', () => {
    expect(decideClassification({ ok: false, blocker: LOW_MARGIN })).toEqual({
      outcome: 'blocked',
      blocker: LOW_MARGIN
    })
  })

  it('rule 2: blocks needs_clarification as missing_inputs, even with a thin margin', () => {
    expect(decide({ taskType: taskTypeAnswer('needs_clarification') })).toEqual({
      outcome: 'blocked',
      blocker: NEEDS_CLARIFICATION
    })
    expect(
      decide({
        taskType: twoWay('needs_clarification', 0.51, 'software_engineering', 0.49)
      })
    ).toEqual({ outcome: 'blocked', blocker: NEEDS_CLARIFICATION })
  })

  it('rule 3: blocks a task type margin below 0.10 or a tie as ambiguous low_margin', () => {
    const a = 'software_engineering'
    const b = 'general_research_analysis'
    expect(decide({ taskType: twoWay(a, 0.54, b, 0.46) })).toEqual({
      outcome: 'blocked',
      blocker: LOW_MARGIN
    })
    expect(decide({ taskType: twoWay(a, 0.5, b, 0.5) })).toEqual({
      outcome: 'blocked',
      blocker: LOW_MARGIN
    })
    expect(decide({ taskType: twoWay(a, 0.55, b, 0.45) }).outcome).toBe('classified')
    // Why: 0.6 - 0.5 is 0.0999... in binary floating point; an exact 0.10 margin must pass.
    expect(decide({ taskType: twoWay(a, 0.6, b, 0.5) }).outcome).toBe('classified')
  })

  it('rule 4: reads the delegation band as 0.6 or more true, 0.4 or less false, between ambiguous', () => {
    const delegation = (value: number) => decide({ needsDelegation: { value } })
    expect(delegation(0.6)).toMatchObject({ result: { needsDelegation: true } })
    expect(delegation(1)).toMatchObject({ result: { needsDelegation: true } })
    expect(delegation(0.4)).toMatchObject({ result: { needsDelegation: false } })
    expect(delegation(0)).toMatchObject({ result: { needsDelegation: false } })
    for (const value of [0.41, 0.5, 0.59]) {
      expect(delegation(value)).toEqual({ outcome: 'blocked', blocker: LOW_MARGIN })
    }
    expect(delegation(0.61)).toMatchObject({ result: { needsDelegation: true } })
    expect(delegation(0.39)).toMatchObject({ result: { needsDelegation: false } })
  })

  it('rule 5: blocks needs_delegation true with coordinator_reasoning as inconsistent_delegation', () => {
    expect(decide({ taskType: taskTypeAnswer('coordinator_reasoning') })).toEqual({
      outcome: 'blocked',
      blocker: INCONSISTENT
    })
  })

  it('rule 6: lets the coordinator task type stay with the primary when delegation is false', () => {
    expect(
      decide({ taskType: taskTypeAnswer('coordinator_reasoning'), needsDelegation: { value: 0.1 } })
    ).toEqual({
      outcome: 'classified',
      result: { needsDelegation: false, taskType: 'coordinator_reasoning' }
    })
  })

  it('records a delegable type with delegation false as classified, never ambiguous', () => {
    expect(decide({ needsDelegation: { value: 0.05 } })).toEqual({
      outcome: 'classified',
      result: { needsDelegation: false, taskType: 'software_engineering' }
    })
  })

  it('runs the rules in pinned order: clarification, then margin, then band, then consistency', () => {
    const coordinator = taskTypeAnswer('coordinator_reasoning')
    const thin = twoWay('coordinator_reasoning', 0.52, 'software_engineering', 0.48)
    expect(decide({ taskType: thin })).toEqual({ outcome: 'blocked', blocker: LOW_MARGIN })
    expect(decide({ taskType: coordinator, needsDelegation: { value: 0.5 } })).toEqual({
      outcome: 'blocked',
      blocker: LOW_MARGIN
    })
  })

  it('rejects a choice that is not in the taxonomy as invalid_output, never substituting', () => {
    for (const choice of ['planning', 'codex_assistant.codex_exec', 'route']) {
      expect(decide({ taskType: twoWay(choice, 0.8, 'needs_clarification', 0.2) })).toEqual({
        outcome: 'invalid_output',
        blocker: { reason: 'invalid_output', detail: 'choice_outside_legal_set' }
      })
    }
  })

  it('never reads provider confidence', () => {
    const base = decide()
    for (const confidence of [0, 0.5, 1]) {
      expect(
        decide({ providerConfidence: { task_type: confidence, needs_delegation: null } })
      ).toEqual(base)
    }
  })

  it('takes its thresholds from the bundle defaults, and accepts others only by argument', () => {
    expect(CLEF_DECISION_THRESHOLDS).toEqual({
      delegationTrueMin: 0.6,
      delegationFalseMax: 0.4,
      taskTypeMarginMin: 0.1
    })
    const near = { needsDelegation: { value: 0.5 } }
    expect(decide(near).outcome).toBe('blocked')
    const loose = { ...CLEF_DECISION_THRESHOLDS, delegationTrueMin: 0.5, delegationFalseMax: 0.1 }
    expect(decideClassification({ ok: true, answers: answers(near) }, loose)).toMatchObject({
      outcome: 'classified',
      result: { needsDelegation: true }
    })
    const zeroMargin = { ...CLEF_DECISION_THRESHOLDS, taskTypeMarginMin: 0 }
    expect(
      decideClassification(
        {
          ok: true,
          answers: answers({
            taskType: twoWay('software_engineering', 0.5, 'high_quality_writing', 0.5)
          })
        },
        zeroMargin
      )
    ).toEqual({ outcome: 'blocked', blocker: LOW_MARGIN })
  })
})

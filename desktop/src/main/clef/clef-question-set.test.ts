import { describe, expect, it } from 'vitest'
import {
  CLEF_CLASSIFIER_QUESTION_IDS,
  CLEF_CLASSIFIER_QUESTION_KINDS,
  CLEF_IDENTIFIER_PATTERN,
  NEEDS_CLARIFICATION_OPTION_ID
} from '../../shared/clef/clef-answers'
import {
  CLASSIFIER_ONLY_TASK_TYPES,
  ROUTING_TASK_TYPES,
  ROUTING_TAXONOMY_VERSION
} from '../../shared/routing-table/routing-table-taxonomy'
import { clefCanonicalSha256 } from './clef-verified-profile'
import {
  CLEF_BUNDLE_VALUES_AWAITING_USER_CONFIRMATION,
  CLEF_DECISION_THRESHOLDS,
  CLEF_QUESTION_BUNDLE,
  CLEF_QUESTION_BUNDLE_SHA256,
  CLEF_QUESTION_ORDER_SHA256,
  CLEF_QUESTION_SET_VERSION,
  CLEF_TAXONOMY_VERSION,
  NEEDS_DELEGATION_CRITERIA,
  QUESTION_INSTRUCTIONS,
  TASK_TYPE_OPTIONS,
  buildClassifierQuestions,
  computeQuestionBundleSha256
} from './clef-question-set'

// The question bundle hash of question_set_version 1, which sent five questions and route options.
const V1_QUESTION_BUNDLE_SHA256 = '5d54d231d1fb0c9c5e013785bb25f723c6600f579c1c91a5076bd488f2668729'
// Why: control text is read by the model and must be plain English (R04, AC-LANG-01).
const PLAIN_ENGLISH = /^[\x20-\x7E]+$/
// Clef classifies; the Routing Table maps. No target, model, effort or surface word may ever be sent.
const ROUTING_WORDS =
  /\b(codex|claude|agy|antigravity|gemini|gpt|opus|sonnet|haiku|model|effort|route|routing|target|profile|surface|plugin|subagent)\b/i

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(collectStrings)
  }
  return []
}

describe('classifier question set', () => {
  it('is question set version 2 over taxonomy version 2', () => {
    expect(CLEF_QUESTION_SET_VERSION).toBe(2)
    expect(CLEF_TAXONOMY_VERSION).toBe(2)
    expect(CLEF_TAXONOMY_VERSION).toBe(ROUTING_TAXONOMY_VERSION)
  })

  it('offers the ten task types in taxonomy order, then needs_clarification', () => {
    expect(Object.keys(TASK_TYPE_OPTIONS)).toEqual([
      ...ROUTING_TASK_TYPES,
      ...CLASSIFIER_ONLY_TASK_TYPES
    ])
    expect(Object.keys(TASK_TYPE_OPTIONS)).toHaveLength(11)
    expect(Object.keys(TASK_TYPE_OPTIONS).at(-1)).toBe(NEEDS_CLARIFICATION_OPTION_ID)
  })

  it('describes the coordinator and clarification options as the design states them', () => {
    expect(TASK_TYPE_OPTIONS.coordinator_reasoning).toContain(
      'coordinating session does for itself'
    )
    expect(TASK_TYPE_OPTIONS.needs_clarification).toContain('does not say clearly enough')
  })

  it('asks needs_delegation as a yes or no with a true and a false description', () => {
    expect(QUESTION_INSTRUCTIONS.needs_delegation).toContain('separate executor')
    expect(NEEDS_DELEGATION_CRITERIA.true).toContain('self-contained')
    expect(NEEDS_DELEGATION_CRITERIA.false).toContain("coordinator's own context")
  })

  it('builds exactly the two questions in pinned order with matching kinds', () => {
    const questions = buildClassifierQuestions()
    expect(Object.keys(questions)).toEqual(['task_type', 'needs_delegation'])
    expect(Object.keys(questions)).toEqual([...CLEF_CLASSIFIER_QUESTION_IDS])
    for (const id of CLEF_CLASSIFIER_QUESTION_IDS) {
      expect(questions[id].type).toBe(CLEF_CLASSIFIER_QUESTION_KINDS[id])
      expect(questions[id].instructions).toBe(QUESTION_INSTRUCTIONS[id])
    }
    expect(questions.task_type.criteria).toBe(TASK_TYPE_OPTIONS)
    expect(questions.needs_delegation.criteria).toBe(NEEDS_DELEGATION_CRITERIA)
  })

  it('sends no target, model, effort or surface text, and no removed question', () => {
    const sent = JSON.stringify(buildClassifierQuestions())
    expect(sent).not.toMatch(ROUTING_WORDS)
    for (const removed of ['difficulty', 'context_scope', 'inputs_complete', '"route"']) {
      expect(sent).not.toContain(removed)
    }
    for (const text of collectStrings(CLEF_QUESTION_BUNDLE)) {
      expect(text).not.toMatch(ROUTING_WORDS)
    }
  })

  it('keeps every control text non-empty plain English and every option id in the charset', () => {
    const questions = buildClassifierQuestions()
    for (const text of collectStrings(CLEF_QUESTION_BUNDLE)) {
      expect(text).toMatch(PLAIN_ENGLISH)
      expect(text.trim()).toBe(text)
    }
    for (const [id, text] of Object.entries(TASK_TYPE_OPTIONS)) {
      expect(id).toMatch(CLEF_IDENTIFIER_PATTERN)
      expect(text.length).toBeGreaterThan(0)
    }
    for (const id of CLEF_CLASSIFIER_QUESTION_IDS) {
      expect(questions[id].instructions.length).toBeGreaterThan(0)
    }
  })

  it('hashes the pinned question order with the Clef canonical JSON', () => {
    expect(CLEF_QUESTION_ORDER_SHA256).toBe(
      clefCanonicalSha256({ question_order: [...CLEF_CLASSIFIER_QUESTION_IDS] })
    )
    expect(CLEF_QUESTION_BUNDLE.question_order).toEqual([...CLEF_CLASSIFIER_QUESTION_IDS])
  })
})

describe('decision thresholds', () => {
  it('are the design defaults: delegation band 0.4 to 0.6 and task type margin 0.10', () => {
    expect(CLEF_DECISION_THRESHOLDS).toEqual({
      delegationTrueMin: 0.6,
      delegationFalseMax: 0.4,
      taskTypeMarginMin: 0.1
    })
    expect(Object.isFrozen(CLEF_DECISION_THRESHOLDS)).toBe(true)
  })

  it('are marked as defaults awaiting user confirmation, together with the option texts', () => {
    expect(CLEF_BUNDLE_VALUES_AWAITING_USER_CONFIRMATION).toEqual([
      'thresholds',
      'task_type_options',
      'needs_delegation_criteria'
    ])
    for (const key of CLEF_BUNDLE_VALUES_AWAITING_USER_CONFIRMATION) {
      expect(Object.keys(CLEF_QUESTION_BUNDLE)).toContain(key)
    }
  })
})

describe('question bundle hash', () => {
  it('differs from the question set 1 hash, so every v1 pin reads as unverified', () => {
    expect(CLEF_QUESTION_BUNDLE_SHA256).not.toBe(V1_QUESTION_BUNDLE_SHA256)
    expect(CLEF_QUESTION_BUNDLE_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is pinned so any bundle text change is deliberate', () => {
    expect(CLEF_QUESTION_BUNDLE_SHA256).toBe(computeQuestionBundleSha256(CLEF_QUESTION_BUNDLE))
    expect(CLEF_QUESTION_BUNDLE_SHA256).toBe(
      '60460f20de6ab2de0eb844b81ecadefc7aa35ca03587f4b1591a6d7484a78ad7'
    )
  })

  it('holds only the classifier texts and thresholds, nothing from the Routing Table', () => {
    expect(Object.keys(CLEF_QUESTION_BUNDLE).toSorted()).toEqual(
      [
        'instructions',
        'needs_delegation_criteria',
        'question_order',
        'question_set_version',
        'task_type_options',
        'taxonomy_version',
        'thresholds'
      ].toSorted()
    )
  })

  it('covers the option texts, the instructions, the order, the taxonomy and the thresholds', () => {
    const changed = (change: Record<string, unknown>) =>
      computeQuestionBundleSha256({ ...CLEF_QUESTION_BUNDLE, ...change })
    expect(changed({ question_order: ['needs_delegation', 'task_type'] })).not.toBe(
      CLEF_QUESTION_BUNDLE_SHA256
    )
    expect(
      changed({
        task_type_options: { ...TASK_TYPE_OPTIONS, software_engineering: 'Anything.' }
      })
    ).not.toBe(CLEF_QUESTION_BUNDLE_SHA256)
    expect(
      changed({ instructions: { ...QUESTION_INSTRUCTIONS, task_type: 'Choose one.' } })
    ).not.toBe(CLEF_QUESTION_BUNDLE_SHA256)
    expect(
      changed({ needs_delegation_criteria: { ...NEEDS_DELEGATION_CRITERIA, true: 'Always.' } })
    ).not.toBe(CLEF_QUESTION_BUNDLE_SHA256)
    expect(changed({ taxonomy_version: 3 })).not.toBe(CLEF_QUESTION_BUNDLE_SHA256)
    expect(
      changed({ thresholds: { ...CLEF_DECISION_THRESHOLDS, taskTypeMarginMin: 0.2 } })
    ).not.toBe(CLEF_QUESTION_BUNDLE_SHA256)
    expect(
      changed({ thresholds: { ...CLEF_DECISION_THRESHOLDS, delegationTrueMin: 0.7 } })
    ).not.toBe(CLEF_QUESTION_BUNDLE_SHA256)
  })

  it('uses the Clef canonical JSON shared with the verified-profile hash', () => {
    expect(computeQuestionBundleSha256(CLEF_QUESTION_BUNDLE)).toBe(
      clefCanonicalSha256(CLEF_QUESTION_BUNDLE)
    )
  })

  it('is independent of key order', () => {
    const { question_order, ...rest } = CLEF_QUESTION_BUNDLE
    expect(computeQuestionBundleSha256({ ...rest, question_order })).toBe(
      CLEF_QUESTION_BUNDLE_SHA256
    )
  })
})

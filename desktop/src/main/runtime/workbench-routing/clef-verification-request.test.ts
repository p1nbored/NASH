import { describe, expect, it } from 'vitest'
import { CLEF_CLASSIFIER_QUESTION_IDS } from '../../../shared/clef/clef-answers'
import { isPinnedClefRequestBody } from '../../clef/clef-endpoint'
import { TASK_TYPE_OPTIONS } from '../../clef/clef-question-set'
import {
  CLEF_VERIFICATION_ACCEPTANCE_CRITERIA,
  CLEF_VERIFICATION_EXPECTED_OUTPUTS,
  CLEF_VERIFICATION_OBJECTIVE,
  buildClefVerificationRequest
} from './clef-verification-request'

describe('clef verification request', () => {
  const { request, sent } = buildClefVerificationRequest()

  it('offers exactly the two classifier questions in pinned order', () => {
    expect(Object.keys(request.body.questions)).toEqual([...CLEF_CLASSIFIER_QUESTION_IDS])
    expect(Object.keys(request.body.questions)).toEqual(['task_type', 'needs_delegation'])
    expect(sent.questions.map((question) => question.id)).toEqual(['task_type', 'needs_delegation'])
  })

  it('sends the eleven task type options and no route, target, model or effort text', () => {
    expect(Object.keys(request.body.questions.task_type.criteria)).toEqual(
      Object.keys(TASK_TYPE_OPTIONS)
    )
    const text = new TextDecoder().decode(request.bodyBytes)
    expect(text).not.toMatch(
      /\b(codex|claude|agy|gemini|gpt|opus|sonnet|effort|surface|plugin|route|difficulty)\b/i
    )
  })

  it('is one synthetic English TaskSpec body pinned to the clef model', () => {
    expect(request.body.model).toBe('clef')
    expect(isPinnedClefRequestBody(request.bodyBytes)).toBe(true)
    expect(request.body.state.objective).toBe(CLEF_VERIFICATION_OBJECTIVE)
    expect(request.body.state.expected_outputs).toEqual([...CLEF_VERIFICATION_EXPECTED_OUTPUTS])
    expect(request.body.state.acceptance_criteria).toEqual([
      ...CLEF_VERIFICATION_ACCEPTANCE_CRITERIA
    ])
    expect(request.body.state.data_class).toBe('agent_task_spec')
    expect(Object.keys(request.body)).toEqual(['model', 'state', 'questions'])
  })

  it('holds no credential, path, address or identifier in what it sends', () => {
    const text = new TextDecoder().decode(request.bodyBytes)
    expect(text).not.toMatch(/Bearer\s/i)
    expect(text).not.toMatch(/[0-9a-f]{32}/)
    expect(text).not.toMatch(/[A-Za-z]:\\|https?:\/\/|@[a-z0-9-]+\.[a-z]{2,}/i)
  })

  it('is deterministic, so the cost estimate and the body hash never drift between calls', () => {
    const again = buildClefVerificationRequest()
    expect(again.request.bodySha256).toBe(request.bodySha256)
    expect(again.request.estimatedInputTokens).toBe(request.estimatedInputTokens)
  })

  it('summarizes each question for the report exactly as it was sent', () => {
    expect(sent.estimatedInputTokens).toBe(request.estimatedInputTokens)
    expect(sent.questions).toEqual([
      { id: 'task_type', kind: 'choice', optionIds: Object.keys(TASK_TYPE_OPTIONS) },
      { id: 'needs_delegation', kind: 'noul' }
    ])
  })
})

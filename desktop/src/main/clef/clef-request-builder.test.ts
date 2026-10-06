import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CLEF_CLASSIFIER_QUESTION_IDS } from '../../shared/clef/clef-answers'
import { CLEF_BODY_MODEL, buildClefRequest } from './clef-request-builder'
import {
  CLEF_MAX_BODY_BYTES,
  CLEF_MAX_ESTIMATED_INPUT_TOKENS,
  estimateClefInputTokens
} from './clef-request-builder-preflight'
import { TASK_TYPE_OPTIONS } from './clef-question-set'
import {
  CLEF_OBJECTIVE_MAX_CHARS,
  CLEF_RAW_INTAKE_MAX_CHARS,
  CLEF_STATE_LIST_ITEM_MAX_CHARS,
  CLEF_STATE_LIST_MAX_ITEMS,
  CLEF_TRUNCATION_MARKER
} from './clef-state-builder'

// FIXTURE_ONLY: fake account id shape used to prove a scan hit blocks before any call.
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'

const intake = { objective: 'Add a retry button to the Workbench queue.' }
const REQUEST_REJECTED = { reason: 'classifier_unavailable', detail: 'request_rejected' }

/** Every optional list filled to its caps with one repeated character. */
function maxedLists(character: string) {
  const items = Array.from({ length: CLEF_STATE_LIST_MAX_ITEMS }, () =>
    character.repeat(CLEF_STATE_LIST_ITEM_MAX_CHARS)
  )
  return { expectedOutputs: items, acceptanceCriteria: items, explicitConstraints: items }
}

function built() {
  const result = buildClefRequest(intake)
  if (!result.ok) {
    throw new Error(`expected a built request, got ${result.blocker.detail}`)
  }
  return result.request
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('buildClefRequest', () => {
  it('builds exactly {model, state, questions} with the two questions in pinned order', () => {
    const request = built()
    expect(Object.keys(request.body)).toEqual(['model', 'state', 'questions'])
    expect(request.body.model).toBe(CLEF_BODY_MODEL)
    expect(CLEF_BODY_MODEL).toBe('clef')
    expect(Object.keys(request.body.questions)).toEqual([...CLEF_CLASSIFIER_QUESTION_IDS])
    expect(Object.keys(request.body.questions)).toEqual(['task_type', 'needs_delegation'])
    expect(request.body.state).toEqual({
      objective: intake.objective,
      data_class: 'agent_task_spec'
    })
  })

  it('offers the eleven task type options in taxonomy order and sends no route question', () => {
    const { questions } = built().body
    expect(Object.keys(questions.task_type.criteria)).toEqual(Object.keys(TASK_TYPE_OPTIONS))
    expect(questions).not.toHaveProperty('route')
    expect(built()).not.toHaveProperty('routeOptionIds')
  })

  it('never sends a target, model or effort word in the body', () => {
    const body = new TextDecoder().decode(built().bodyBytes)
    expect(body).not.toMatch(/\b(codex|claude|agy|gemini|gpt|opus|sonnet|effort|surface|plugin)\b/i)
  })

  it('carries a TaskSpec with every field in the state, masked and labeled', () => {
    const result = buildClefRequest({
      objective: 'Add a retry button.',
      expectedOutputs: ['A change to the queue.'],
      acceptanceCriteria: ['The tests pass.'],
      explicitConstraints: ['Keep the design.']
    })
    expect(result.ok && result.request.body.state).toEqual({
      objective: 'Add a retry button.',
      expected_outputs: ['A change to the queue.'],
      acceptance_criteria: ['The tests pass.'],
      explicit_constraints: ['Keep the design.'],
      data_class: 'agent_task_spec'
    })
  })

  it('keeps the body bytes, their SHA-256, the state hash and the token estimate', () => {
    const request = built()
    const serialized = JSON.stringify(request.body)
    expect(new TextDecoder().decode(request.bodyBytes)).toBe(serialized)
    expect(request.bodySha256).toBe(sha256(request.bodyBytes))
    expect(request.stateSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(request.estimatedInputTokens).toBe(
      estimateClefInputTokens(request.body.state, request.body.questions)
    )
    expect(serialized).not.toContain(request.bodySha256)
  })

  it('is deterministic for the same TaskSpec', () => {
    expect(built().bodySha256).toBe(built().bodySha256)
    expect(built().stateSha256).toBe(built().stateSha256)
  })

  it('never sends images or options', () => {
    const body = JSON.parse(new TextDecoder().decode(built().bodyBytes))
    expect(body).not.toHaveProperty('images')
    expect(body).not.toHaveProperty('options')
  })

  it('blocks a content-scan hit as data_boundary_forbids and reports only rule names', () => {
    const result = buildClefRequest({
      objective: `Bill account ${FIXTURE_ONLY_ACCOUNT_ID} for it.`
    })
    expect(result).toEqual({
      ok: false,
      blocker: { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      matchedRules: ['hex_identifier']
    })
  })

  it('scans optional fields too', () => {
    const result = buildClefRequest({
      ...intake,
      explicitConstraints: ['Only edit /etc/hosts here.']
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.blocker.detail).toBe('data_boundary_forbids')
  })

  it('builds a request for a non-English objective (D-027)', () => {
    const result = buildClefRequest({ objective: '修复登录页面' })
    expect(result.ok && result.request.body.state.objective).toBe('修复登录页面')
  })

  it('shrinks the excerpt until the token estimate fits, instead of blocking', () => {
    const characters = JSON.stringify(maxedLists('"')).length
    expect(characters / 4).toBeGreaterThan(CLEF_MAX_ESTIMATED_INPUT_TOKENS)
    const result = buildClefRequest({ objective: 'Quote these.', ...maxedLists('"') })
    if (!result.ok) {
      throw new Error(`expected a request, got ${result.blocker.detail}`)
    }
    expect(result.request.estimatedInputTokens).toBeLessThanOrEqual(CLEF_MAX_ESTIMATED_INPUT_TOKENS)
    expect(result.request.body.state.expected_outputs?.[0]?.endsWith(CLEF_TRUNCATION_MARKER)).toBe(
      true
    )
  })

  it('shrinks the excerpt until multi-byte state text fits the 64 KiB body cap', () => {
    // Why: U+1E01 is a Latin letter that takes three UTF-8 bytes, so bytes outgrow characters.
    const wide = { objective: 'Spell these.', ...maxedLists('ḁ') }
    const characters = 3 * CLEF_STATE_LIST_MAX_ITEMS * CLEF_STATE_LIST_ITEM_MAX_CHARS
    expect(characters * 3).toBeGreaterThan(CLEF_MAX_BODY_BYTES)
    const result = buildClefRequest(wide)
    expect(result.ok && result.request.bodyBytes.byteLength).toBeLessThanOrEqual(
      CLEF_MAX_BODY_BYTES
    )
  })

  it('classifies a TaskSpec past every cap from a bounded excerpt with truncation markers', () => {
    const items = Array.from({ length: 40 }, (_, index) => `第${index}项。${'内容'.repeat(400)}`)
    const result = buildClefRequest({
      objective: `修复登录页面。${'详细说明。'.repeat(1_000)}`,
      expectedOutputs: items,
      acceptanceCriteria: items,
      explicitConstraints: items
    })
    if (!result.ok) {
      throw new Error(`expected a request, got ${result.blocker.detail}`)
    }
    const { state } = result.request.body
    expect(state.objective.endsWith(` ${CLEF_TRUNCATION_MARKER}`)).toBe(true)
    expect(state.objective.length).toBeLessThanOrEqual(CLEF_OBJECTIVE_MAX_CHARS)
    expect(state.acceptance_criteria?.at(-1)).toMatch(/^\[truncated: \d+ more items\]$/)
    expect(result.request.bodyBytes.byteLength).toBeLessThanOrEqual(CLEF_MAX_BODY_BYTES)
  })

  it('still blocks a secret shape that sits past the cut, because the whole text is scanned', () => {
    const padding = 'Plan the work. '.repeat(Math.ceil(CLEF_OBJECTIVE_MAX_CHARS / 10))
    const result = buildClefRequest({ objective: `${padding}${FIXTURE_ONLY_ACCOUNT_ID}` })
    expect(result).toEqual({
      ok: false,
      blocker: { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      matchedRules: ['hex_identifier']
    })
  })

  it('rejects raw intake past the TaskSpec ceiling before scanning it', () => {
    const padding = 'a '.repeat(CLEF_RAW_INTAKE_MAX_CHARS / 2)
    const result = buildClefRequest({ objective: `${padding}${FIXTURE_ONLY_ACCOUNT_ID}` })
    expect(result).toEqual({ ok: false, blocker: REQUEST_REJECTED, matchedRules: [] })
  })
})

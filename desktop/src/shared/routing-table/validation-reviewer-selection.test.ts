import { describe, expect, it } from 'vitest'
import type { ValidationReviewer } from './routing-table-schema'
import { selectValidationReviewer } from './validation-reviewer-selection'

const CODEX_SOL: ValidationReviewer = {
  target: 'codex_cli',
  model: 'gpt-6.1-sol',
  reasoning_level: 'high'
}
const CLAUDE_OPUS: ValidationReviewer = {
  target: 'claude_headless',
  model: 'claude-opus-5-5',
  reasoning_level: 'high'
}
const DEFAULT_REVIEWERS = [CODEX_SOL, CLAUDE_OPUS]

describe('selectValidationReviewer (D-017)', () => {
  it('picks the first reviewer when the work was done by another model', () => {
    expect(selectValidationReviewer(DEFAULT_REVIEWERS, 'claude-sonnet-5-5')).toEqual({
      ok: true,
      reviewer: CODEX_SOL
    })
  })

  it('skips a reviewer whose model did the work and takes the next one', () => {
    expect(selectValidationReviewer(DEFAULT_REVIEWERS, 'gpt-6.1-sol')).toEqual({
      ok: true,
      reviewer: CLAUDE_OPUS
    })
  })

  it('returns none when every reviewer is the model that did the work', () => {
    expect(
      selectValidationReviewer([CODEX_SOL, { ...CODEX_SOL, reasoning_level: 'max' }], 'gpt-6.1-sol')
    ).toEqual({
      ok: false,
      reason: 'no_independent_reviewer'
    })
  })

  it('returns none for an empty list', () => {
    expect(selectValidationReviewer([], 'claude-sonnet-5-5')).toEqual({
      ok: false,
      reason: 'no_independent_reviewer'
    })
  })

  it('compares model ids ignoring case, so a re-cased id is still the same model', () => {
    expect(selectValidationReviewer(DEFAULT_REVIEWERS, 'GPT-6.1-Sol')).toEqual({
      ok: true,
      reviewer: CLAUDE_OPUS
    })
  })

  it('keeps the configured order even when a later reviewer would also differ', () => {
    const reversed = [CLAUDE_OPUS, CODEX_SOL]
    expect(selectValidationReviewer(reversed, 'gemini-3.8-flash-high')).toEqual({
      ok: true,
      reviewer: CLAUDE_OPUS
    })
  })

  it('does not treat a different reasoning level of the same model as independent', () => {
    expect(
      selectValidationReviewer([{ ...CODEX_SOL, reasoning_level: 'max' }], 'gpt-6.1-sol')
    ).toEqual({ ok: false, reason: 'no_independent_reviewer' })
  })

  it.each([null, undefined, '', '   '])(
    'fails closed when the model that did the work is unknown (%j)',
    (workModel) => {
      expect(selectValidationReviewer(DEFAULT_REVIEWERS, workModel)).toEqual({
        ok: false,
        reason: 'work_model_unknown'
      })
    }
  )

  it('does not change the list it was given', () => {
    const reviewers = [...DEFAULT_REVIEWERS]
    selectValidationReviewer(reviewers, 'gpt-6.1-sol')
    expect(reviewers).toEqual(DEFAULT_REVIEWERS)
  })
})

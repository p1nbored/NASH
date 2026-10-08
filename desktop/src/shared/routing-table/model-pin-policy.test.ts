import { describe, expect, it } from 'vitest'
import { CLAUDE_SESSION_OPTION_CATALOG } from '../agent-session-option-catalog-claude-codex'
import { PinnedModelIdSchema, modelPinViolation } from './model-pin-policy'

describe('modelPinViolation (ARCH 7.5)', () => {
  it.each([
    'claude-fable-5-1',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-4-5-20251001',
    'gpt-6-astra',
    'gpt-6.1-sol',
    'gemini-3.8-flash-high',
    'gemini-3.8-flash-medium',
    'gemini-3.8-flash-low',
    'gemini-40',
    'gemini-3-pro',
    'models/gemini-3-flash',
    'anthropic:claude-haiku-5'
  ])('accepts the exact slug %s', (model) => {
    expect(modelPinViolation(model)).toBeNull()
    expect(PinnedModelIdSchema.safeParse(model).success).toBe(true)
  })

  it.each([
    'gemini-4',
    'gemini-4-pro',
    'Gemini_4',
    'gemini4',
    'gemini.4-flash',
    'models/gemini-4.0',
    'GEMINI-4-ULTRA',
    'argon',
    'gemini-argon',
    'Gemini-Argon-1'
  ])('accepts exact Gemini 4 slugs without a family ban: %s', (model) => {
    expect(modelPinViolation(model)).toBeNull()
  })

  it.each([
    'auto',
    'latest',
    'flash',
    'pro',
    'inherit',
    'AUTO',
    'Pro',
    'google/flash',
    'agy:pro',
    'claude-opus-latest',
    'gpt-6-astra@latest',
    'models/auto',
    'gemini-3-pro-latest',
    'inherit-from-session'
  ])('rejects the floating selector %s', (model) => {
    expect(modelPinViolation(model)).toBe('model_alias_unpinned')
  })

  it.each([
    'opus',
    'sonnet',
    'haiku',
    'spark',
    'Opus',
    'SONNET',
    'anthropic/opus',
    'codex:spark',
    'fable',
    'Fable',
    'anthropic/fable',
    'opusplan',
    'OpusPlan',
    'anthropic:opusplan'
  ])('rejects the bare alias %s', (model) => {
    expect(modelPinViolation(model)).toBe('model_alias_unpinned')
    expect(PinnedModelIdSchema.safeParse(model).success).toBe(false)
  })

  // Why a test-time guard, not a runtime derivation: the catalog is a UI picker list, so an alias
  // the upstream picker adds must fail here first, and an exact id added there is a decision to revisit.
  it('rejects every Claude CLI alias that the session picker offers as a model choice', () => {
    const ids = CLAUDE_SESSION_OPTION_CATALOG.models.map((model) => model.id)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(modelPinViolation(id), id).toBe('model_alias_unpinned')
      expect(PinnedModelIdSchema.safeParse(id).success, id).toBe(false)
    }
  })

  it.each([
    'gpt-6-sol',
    'GPT-6-SOL',
    'openai/gpt-6-sol',
    'gpt-5.3-codex-spark',
    'gpt-5.3-Codex-Spark'
  ])('leaves concrete model availability to the CLI catalog: %s', (model) => {
    expect(modelPinViolation(model)).toBeNull()
  })

  it.each(['', ' ', 'has space', '-leading-dash', 'opus[1m]', 'x'.repeat(201), 'tab\tid'])(
    'rejects the malformed id %j',
    (model) => {
      expect(modelPinViolation(model)).toBe('model_unapproved')
      expect(PinnedModelIdSchema.safeParse(model).success).toBe(false)
    }
  )

  it('lets the schema refuse every violation, not just malformed ids', () => {
    for (const model of ['bad model', 'opus', 'latest']) {
      expect(PinnedModelIdSchema.safeParse(model).success).toBe(false)
    }
  })
})

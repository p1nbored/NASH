import { describe, expect, it } from 'vitest'
import { isSameModel, normalizeModelId } from './model-id-normalization'

describe('model id normalization', () => {
  it('folds case, spacing, effort variants, date snapshots and path prefixes', () => {
    expect(normalizeModelId(' Claude-Opus-5-5 ')).toBe('claude-opus-5-5')
    expect(normalizeModelId('claude-opus-5-5-high')).toBe('claude-opus-5-5')
    expect(normalizeModelId('gemini-3.8-flash-medium')).toBe('gemini-3.8-flash')
    expect(normalizeModelId('gpt-oss-120b-medium')).toBe('gpt-oss-120b')
    expect(normalizeModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
    expect(normalizeModelId('anthropic/claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
    expect(normalizeModelId('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
    expect(normalizeModelId('gpt-6.1-sol')).toBe('gpt-6.1-sol')
  })

  it('folds version dots, ISO date snapshots and thinking variants into one spelling', () => {
    expect(isSameModel('claude-opus-4.5', 'claude-opus-4-5')).toBe(true)
    expect(normalizeModelId('gpt-6.1-sol-2026-09-01')).toBe('gpt-6.1-sol')
    expect(normalizeModelId('claude-sonnet-5-5-thinking')).toBe('claude-sonnet-5-5')
    expect(isSameModel('gpt-6.1-sol', 'gpt-6-sol')).toBe(false)
  })

  it('folds the ultra, minimal and none variants too, so a reviewer is never the same model (D-027)', () => {
    for (const level of ['ultra', 'minimal', 'none']) {
      expect(isSameModel(`gemini-3.8-flash-${level}`, 'gemini-3.8-flash-high')).toBe(true)
    }
  })

  it('treats a -latest id as floating, so it names no fixed model', () => {
    expect(normalizeModelId('claude-opus-latest')).toBeNull()
  })

  it('expands the short Claude spelling the CLI aliases to the full id', () => {
    expect(normalizeModelId('opus-5-5')).toBe('claude-opus-5-5')
    expect(normalizeModelId('sonnet-5-5-max')).toBe('claude-sonnet-5-5')
  })

  it('returns null for floating aliases and malformed ids, which name no fixed model', () => {
    for (const id of ['opus', 'sonnet', 'fable', 'default', 'latest', 'inherit', '', '  ', 'a b']) {
      expect(normalizeModelId(id)).toBeNull()
    }
  })

  it('treats ids as the same model only when both normalize to one id', () => {
    expect(isSameModel('claude-opus-5-5', 'claude-opus-5-5-high')).toBe(true)
    expect(isSameModel('opus-5-5', 'CLAUDE-OPUS-5-5')).toBe(true)
    expect(isSameModel('gpt-6.1-sol', 'claude-opus-5-5')).toBe(false)
    expect(isSameModel('gpt-6.1-sol', 'gpt-6-sol')).toBe(false)
  })

  it('cannot show two models differ when either one is unknown', () => {
    expect(isSameModel('opus', 'gpt-6.1-sol')).toBeNull()
    expect(isSameModel('gpt-6.1-sol', null)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  CLAUDE_EFFORT_LEVELS,
  COORDINATOR_EFFORT_LEVELS,
  PRIMARY_SESSION_ACCESS_VALUES,
  PRIMARY_SESSION_REFUSAL_CODES,
  parseClaudeModelChoice,
  primarySessionOk,
  primarySessionRefused
} from './primary-session-types'

describe('primary session result helpers', () => {
  it('wraps a value as ok and a refusal with its English detail', () => {
    expect(primarySessionOk(7)).toEqual({ ok: true, value: 7 })
    expect(
      primarySessionRefused('autopilot_session_posture_invalid', 'Unknown access value.')
    ).toEqual({
      ok: false,
      refusal: { code: 'autopilot_session_posture_invalid', detail: 'Unknown access value.' }
    })
  })

  it('prefixes every refusal code so the RPC layer can pass it through unchanged', () => {
    expect(PRIMARY_SESSION_REFUSAL_CODES.length).toBeGreaterThan(8)
    for (const code of PRIMARY_SESSION_REFUSAL_CODES) {
      expect(code).toMatch(/^autopilot_session_[a-z_]+$/)
    }
    expect(new Set(PRIMARY_SESSION_REFUSAL_CODES).size).toBe(PRIMARY_SESSION_REFUSAL_CODES.length)
  })

  it('knows the two accesses and every policy effort level (D-027: the listing decides)', () => {
    expect([...PRIMARY_SESSION_ACCESS_VALUES]).toEqual(['read_only', 'workspace_write'])
    expect([...CLAUDE_EFFORT_LEVELS]).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra'
    ])
  })
})

describe('parseClaudeModelChoice', () => {
  it.each([...COORDINATOR_EFFORT_LEVELS])('accepts claude-opus-5-5 at %s', (effort) => {
    expect(parseClaudeModelChoice('claude-opus-5-5', effort)).toEqual({
      ok: true,
      value: { model: 'claude-opus-5-5', effort }
    })
  })

  it.each(['none', 'minimal', 'ultra'])(
    'refuses %s for the coordinator, whose launch catalog applies only low to max',
    (effort) => {
      const result = parseClaudeModelChoice('claude-opus-5-5', effort)
      expect(result).toMatchObject({
        ok: false,
        refusal: { code: 'autopilot_session_model_invalid' }
      })
      if (!result.ok) {
        expect(result.refusal.detail).toContain('low, medium, high, xhigh, max')
      }
    }
  )

  it.each([...CLAUDE_EFFORT_LEVELS])(
    'accepts %s where every level is allowed (subagents)',
    (effort) => {
      expect(parseClaudeModelChoice('claude-opus-5-5', effort, CLAUDE_EFFORT_LEVELS)).toEqual({
        ok: true,
        value: { model: 'claude-opus-5-5', effort }
      })
    }
  )

  it('accepts a dated full model id', () => {
    expect(parseClaudeModelChoice('claude-haiku-4-5-20251001', 'low').ok).toBe(true)
  })

  it.each([
    ['inherit', 'inherit'],
    ['an alias', 'opus'],
    ['latest', 'latest'],
    ['auto', 'auto'],
    ['a Gemini id', 'gemini-3.8-flash-high'],
    ['a GPT id', 'gpt-6.1-sol'],
    ['an empty string', ''],
    ['uppercase', 'Claude-Opus-5-5'],
    ['a bracket suffix', 'claude-opus-5-5[1m]'],
    ['a space', 'claude opus'],
    ['a quote', "claude-opus-5-5'"],
    ['a backtick', 'claude-opus`5'],
    ['too long', `claude-${'a'.repeat(120)}`],
    ['the bare prefix', 'claude-']
  ])('refuses the model %s', (_label, model) => {
    const result = parseClaudeModelChoice(model, 'max')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_model_invalid')
    }
  })

  it.each([
    ['an unknown level', 'extreme'],
    ['inherit', 'inherit'],
    ['uppercase', 'MAX'],
    ['a number', 5],
    ['an empty string', ''],
    ['null', null]
  ])('refuses the effort %s', (_label, effort) => {
    const result = parseClaudeModelChoice('claude-opus-5-5', effort)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_model_invalid')
    }
  })

  it('refuses a non-string model', () => {
    expect(parseClaudeModelChoice(undefined, 'max').ok).toBe(false)
    expect(parseClaudeModelChoice(12, 'max').ok).toBe(false)
  })
})

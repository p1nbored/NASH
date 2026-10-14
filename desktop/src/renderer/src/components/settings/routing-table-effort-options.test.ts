import { describe, expect, it } from 'vitest'
import {
  routingCli,
  routingEffortFor,
  routingEffortOptions,
  routingModelForEffort
} from './routing-table-effort-options'

const AGY_MODELS = ['low', 'medium', 'high'].map((effort) => ({
  id: `gemini-3.8-flash-${effort}`,
  label: effort,
  efforts: [effort]
}))

describe('routing launch options', () => {
  it('resolves additional CLI targets without treating them as Claude', () => {
    expect(routingCli('gemini_cli')).toBe('gemini')
    expect(routingCli('opencode_cli')).toBe('opencode')
    expect(routingCli('agy_cli')).toBe('antigravity')
  })

  it.each(['gemini', 'omp', 'opencode'] as const)('uses no effort flag for %s', (agent) => {
    expect(routingEffortOptions(agent, 'provider/model')).toEqual([])
    expect(routingEffortFor(agent, 'provider/model', 'ultra')).toBe('none')
  })

  it('sets the encoded effort when selecting an Antigravity model', () => {
    expect(routingEffortFor('antigravity', 'gemini-3.8-flash-low', 'high', AGY_MODELS)).toBe('low')
    expect(routingEffortOptions('antigravity', 'gemini-3.8-flash-low', AGY_MODELS)).toEqual([
      'low',
      'medium',
      'high'
    ])
  })

  it('switches Antigravity model IDs only to discovered matching variants', () => {
    expect(routingModelForEffort('antigravity', 'gemini-3.8-flash-high', 'low', AGY_MODELS)).toBe(
      'gemini-3.8-flash-low'
    )
    expect(routingModelForEffort('antigravity', 'gemini-3.8-flash-high', 'ultra', AGY_MODELS)).toBe(
      'gemini-3.8-flash-high'
    )
    expect(routingModelForEffort('codex', 'gpt-6-astra', 'low', AGY_MODELS)).toBe('gpt-6-astra')
  })
})

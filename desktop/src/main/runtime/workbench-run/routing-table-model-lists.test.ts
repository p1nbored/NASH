import { describe, expect, it } from 'vitest'
import { listedRoutingModels } from './routing-table-model-lists'

describe('routing model list projection', () => {
  it('resolves and deduplicates CLI aliases while retaining supported effort choices', () => {
    expect(
      listedRoutingModels({
        ok: true,
        observedAtMs: 1,
        models: [
          {
            id: 'sonnet',
            resolvedModel: 'claude-sonnet-5-5',
            label: 'Sonnet',
            efforts: ['low', 'high']
          },
          {
            id: 'claude-sonnet-5-5',
            resolvedModel: null,
            label: 'Sonnet duplicate',
            efforts: ['high']
          },
          { id: 'auto', resolvedModel: null, label: 'Auto', efforts: [] }
        ]
      })
    ).toEqual([{ id: 'claude-sonnet-5-5', label: 'Sonnet', efforts: ['high'] }])
  })
  it('does not replace a failed CLI listing with a static model list', () => {
    expect(listedRoutingModels({ ok: false, observedAtMs: 1 })).toBeNull()
  })
  it('accepts a concrete model reported by the CLI without a static slug blocklist', () => {
    expect(
      listedRoutingModels({
        ok: true,
        observedAtMs: 1,
        models: [{ id: 'gpt-6-sol', resolvedModel: null, label: 'Listed model', efforts: ['high'] }]
      })
    ).toEqual([{ id: 'gpt-6-sol', label: 'Listed model', efforts: ['high'] }])
  })
})

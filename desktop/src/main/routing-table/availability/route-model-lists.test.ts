import { describe, expect, it } from 'vitest'
import { createEvaluatorHarness } from './route-availability-harness.test-fixture'

describe('routing model lists', () => {
  it('reads all provider catalogs and reuses the same held lists without quota probes', async () => {
    const h = createEvaluatorHarness()
    const initial = await h.evaluator.listModels('cached')
    expect(Object.values(initial).every((listing) => !listing.ok)).toBe(true)
    expect(h.calls).toMatchObject({ claude: 0, codex: 0, agy: 0, refresh: 0 })
    const listed = await h.evaluator.listModels('recheck')
    expect(Object.values(listed).every((listing) => listing.ok)).toBe(true)
    expect(await h.evaluator.listModels('cached')).toEqual(listed)
    expect(h.calls).toMatchObject({ claude: 1, codex: 1, agy: 1, refresh: 0, detect: 0 })
  })
})

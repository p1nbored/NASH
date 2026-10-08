import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'

describe('default global settings', () => {
  it("leaves Orca's plugin catalog off until the user opts in (D-039)", () => {
    expect(getDefaultSettings('/tmp').useOrcaPluginCatalog).toBe(false)
  })
})

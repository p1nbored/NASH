import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/i18n/localized-catalog', () => ({
  createLocalizedCatalog:
    <T>(loader: () => T) =>
    () =>
      loader()
}))

import { getPluginsPaneSearchEntries } from './plugins-search'

describe('getPluginsPaneSearchEntries', () => {
  it('finds the Orca plugin catalog switch next to the plugin entries (D-039)', () => {
    const entries = getPluginsPaneSearchEntries()
    const catalog = entries.find((entry) => entry.title === "Use Orca's plugin catalog")

    expect(entries[0]?.title).toBe('Plugins')
    expect(catalog?.description).toBe(
      "Downloads Orca's official plugin list and plugin safety list from Orca's servers."
    )
    expect(catalog?.keywords).toEqual(
      expect.arrayContaining(['Orca marketplace', 'plugin safety list'])
    )
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  OFFICIAL_MARKETPLACE_GIT_SOURCE,
  type PluginMarketplace,
  type PluginMarketplaceGitSource
} from '../../shared/plugins/plugin-marketplace'
import type { PluginMarketplaceFetchResult } from '../plugins/plugin-marketplace-fetch'
import type { PluginMarketplaceRegisteredSource } from '../plugins/plugin-marketplace-store'
import {
  isOrcaPluginCatalogEnabled,
  OrcaPluginCatalogMarketplaceService
} from './orca-plugin-catalog-adapter'

const roots: string[] = []

const COMMUNITY_SOURCE: PluginMarketplaceGitSource = {
  kind: 'git',
  url: 'https://github.com/community/plugins.git',
  ref: 'main'
}

function marketplace(owner: string, pluginKey: string, pluginUrl: string): PluginMarketplace {
  return {
    name: `${owner} plugins`,
    owner,
    plugins: [
      {
        id: pluginKey,
        source: { kind: 'git', url: pluginUrl, ref: 'v1' },
        categories: ['productivity']
      }
    ]
  }
}

type MarketplaceFetcher = (
  registration: PluginMarketplaceRegisteredSource
) => Promise<PluginMarketplaceFetchResult>

// Fake git fetch: no clone and no network; answers by source URL.
function fakeFetcher(): Mock<MarketplaceFetcher> {
  return vi.fn<MarketplaceFetcher>(async (registration) => ({
    marketplaceCommit: 'a'.repeat(40),
    marketplace:
      registration.source.url === OFFICIAL_MARKETPLACE_GIT_SOURCE.url
        ? marketplace(
            'stablyai',
            'stablyai.orca-notes',
            'https://github.com/stablyai/orca-notes.git'
          )
        : marketplace('community', 'community.notes', 'https://github.com/community/notes.git')
  }))
}

async function createService(catalog: { enabled: boolean }): Promise<{
  service: OrcaPluginCatalogMarketplaceService
  fetcher: Mock<MarketplaceFetcher>
}> {
  const root = await mkdtemp(join(tmpdir(), 'nash-orca-plugin-catalog-'))
  roots.push(root)
  const fetcher = fakeFetcher()
  const service = new OrcaPluginCatalogMarketplaceService({
    pluginsDataDir: root,
    fetcher,
    isCatalogEnabled: () => catalog.enabled
  })
  return { service, fetcher }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('isOrcaPluginCatalogEnabled', () => {
  it('is off unless the user opted in', () => {
    expect(isOrcaPluginCatalogEnabled(undefined)).toBe(false)
    expect(isOrcaPluginCatalogEnabled({ useOrcaPluginCatalog: false })).toBe(false)
    expect(isOrcaPluginCatalogEnabled({ useOrcaPluginCatalog: true })).toBe(true)
  })
})

describe('OrcaPluginCatalogMarketplaceService', () => {
  it('adds no Orca marketplace while the catalog is off', async () => {
    const { service, fetcher } = await createService({ enabled: false })

    await expect(service.seedOfficialSource()).rejects.toThrow("Orca's plugin catalog is off")

    expect(fetcher).not.toHaveBeenCalled()
    await expect(service.listSources()).resolves.toEqual([])
  })

  it("seeds Orca's marketplace through Orca's service when the catalog is on", async () => {
    const { service, fetcher } = await createService({ enabled: true })

    await expect(service.seedOfficialSource()).resolves.toMatchObject({
      official: true,
      marketplace: { owner: 'stablyai' }
    })

    expect(fetcher).toHaveBeenCalledOnce()
    await expect(service.listSources()).resolves.toEqual([
      expect.objectContaining({ official: true })
    ])
  })

  it('keeps the managed official source from being removed while the catalog is on', async () => {
    const { service } = await createService({ enabled: true })
    const seeded = await service.seedOfficialSource()

    await expect(service.removeSource(seeded.id)).rejects.toThrow('cannot be removed')
  })

  it('lets the user remove an existing Orca marketplace after turning the catalog off', async () => {
    const catalog = { enabled: true }
    const { service } = await createService(catalog)
    const added = await service.addSource(OFFICIAL_MARKETPLACE_GIT_SOURCE)
    catalog.enabled = false
    await expect(service.listSources()).resolves.toEqual([
      expect.objectContaining({ id: added.id, official: false })
    ])
    await expect(service.removeSource(added.id)).resolves.toBe(true)
    await expect(service.listSources()).resolves.toEqual([])
  })

  it("does not put Orca's marketplace back after the catalog is turned off", async () => {
    const catalog = { enabled: true }
    const { service, fetcher } = await createService(catalog)
    const seeded = await service.seedOfficialSource()
    const community = await service.addSource(COMMUNITY_SOURCE)

    catalog.enabled = false
    await expect(service.removeSource(seeded.id)).resolves.toBe(true)
    // Orca re-seeds its marketplace whenever a source is removed; the catalog switch stops that.
    await expect(service.removeSource(community.id)).resolves.toBe(true)

    await expect(service.listSources()).resolves.toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("restores Orca's marketplace when the catalog is turned back on in the same session", async () => {
    const catalog = { enabled: true }
    const { service } = await createService(catalog)
    const seeded = await service.seedOfficialSource()
    catalog.enabled = false
    await service.removeSource(seeded.id)

    catalog.enabled = true
    await expect(service.seedOfficialSource()).resolves.toMatchObject({
      id: seeded.id,
      official: true,
      marketplace: { owner: 'stablyai' }
    })

    await expect(service.listSources()).resolves.toEqual([
      expect.objectContaining({ id: seeded.id, official: true })
    ])
  })
})

describe('Orca catalog network opt-in', () => {
  it('refuses adding the official source while off without fetching it', async () => {
    const { service, fetcher } = await createService({ enabled: false })
    await expect(service.addSource(OFFICIAL_MARKETPLACE_GIT_SOURCE)).rejects.toThrow(
      'catalog is off'
    )
    expect(fetcher).not.toHaveBeenCalled()
    await expect(service.listSources()).resolves.toEqual([])
  })

  it('refuses refreshing a cached official source after the switch is turned off', async () => {
    const catalog = { enabled: true }
    const { service, fetcher } = await createService(catalog)
    const source = await service.seedOfficialSource()
    catalog.enabled = false
    fetcher.mockClear()
    await expect(service.refreshSource(source.id)).rejects.toThrow('catalog is off')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(service.listPlugins()).resolves.toHaveLength(1)
  })

  it('refreshes community sources while keeping the cached official source unchanged', async () => {
    const catalog = { enabled: true }
    const { service, fetcher } = await createService(catalog)
    const source = await service.seedOfficialSource()
    const community = await service.addSource(COMMUNITY_SOURCE)
    catalog.enabled = false
    fetcher.mockClear()
    const refreshed = await service.refreshAll()
    expect(refreshed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: source.id,
          marketplace: source.marketplace,
          official: false
        }),
        expect.objectContaining({ id: community.id, stale: false })
      ])
    )
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0].source.url).toBe(COMMUNITY_SOURCE.url)
  })
})

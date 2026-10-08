import type { GlobalSettings } from '../../shared/global-settings-types'
import { ORCA_CLOUD_SERVICES_ENABLED } from '../../shared/orca-cloud-services'
import {
  OFFICIAL_MARKETPLACE_GIT_SOURCE,
  isOfficialMarketplaceGitSource,
  type PluginMarketplaceGitSource
} from '../../shared/plugins/plugin-marketplace'
import {
  PluginMarketplaceService,
  type PluginMarketplaceListing,
  type PluginMarketplaceSourceState
} from '../plugins/plugin-marketplace-service'
import { PluginMarketplaceStore } from '../plugins/plugin-marketplace-store'

// NASH compatibility adapter (D-039) around Orca's unchanged plugin marketplace service:
// Orca's official marketplace and plugin safety list are used only when the user opts in.

export function isOrcaPluginCatalogEnabled(
  settings: Pick<GlobalSettings, 'useOrcaPluginCatalog'> | null | undefined
): boolean {
  return ORCA_CLOUD_SERVICES_ENABLED || settings?.useOrcaPluginCatalog === true
}

type MarketplaceServiceOptions = ConstructorParameters<typeof PluginMarketplaceService>[0]

export class OrcaPluginCatalogMarketplaceService extends PluginMarketplaceService {
  private readonly catalogStore: PluginMarketplaceStore
  private readonly isCatalogEnabled: () => boolean
  private officialRestore: Promise<unknown> | null = null

  constructor(options: MarketplaceServiceOptions & { isCatalogEnabled: () => boolean }) {
    const { isCatalogEnabled, ...serviceOptions } = options
    // Why: Orca's service keeps its store private; sharing one instance lets the adapter
    // remove a source Orca would refuse to remove.
    const store = serviceOptions.store ?? new PluginMarketplaceStore(serviceOptions.pluginsDataDir)
    super({ ...serviceOptions, store })
    this.catalogStore = store
    this.isCatalogEnabled = isCatalogEnabled
  }

  override async listSources(): Promise<PluginMarketplaceSourceState[]> {
    await this.officialRestore?.catch(() => undefined)
    return (await super.listSources()).map((state) => this.projectCatalogState(state))
  }

  override async listPlugins(): Promise<PluginMarketplaceListing[]> {
    await this.officialRestore?.catch(() => undefined)
    return super.listPlugins()
  }

  override async addSource(
    source: PluginMarketplaceGitSource
  ): Promise<PluginMarketplaceSourceState> {
    if (!this.isCatalogEnabled() && isOfficialMarketplaceGitSource(source.url)) {
      throw new Error("Orca's plugin catalog is off")
    }
    return this.projectCatalogState(await super.addSource(source))
  }

  override async refreshSource(sourceId: string): Promise<PluginMarketplaceSourceState> {
    if (!this.isCatalogEnabled() && (await this.isOfficialSource(sourceId))) {
      throw new Error("Orca's plugin catalog is off")
    }
    return this.projectCatalogState(await super.refreshSource(sourceId))
  }

  override async refreshAll(): Promise<PluginMarketplaceSourceState[]> {
    const states = await this.listSources()
    return Promise.all(
      states.map(async (state) =>
        !this.isCatalogEnabled() && isOfficialMarketplaceGitSource(state.source.url)
          ? state
          : this.refreshSource(state.id)
      )
    )
  }

  override async removeSource(sourceId: string): Promise<boolean> {
    if (!this.isCatalogEnabled() && (await this.isOfficialSource(sourceId))) {
      // Why: with the catalog off NASH does not manage Orca's marketplace, so the user may drop it.
      return this.catalogStore.removeSource(sourceId)
    }
    return super.removeSource(sourceId)
  }

  override seedOfficialSource(): Promise<PluginMarketplaceSourceState> {
    if (!this.isCatalogEnabled()) {
      // Why: Orca re-seeds after every source removal; the switch must stop that too.
      return Promise.reject(new Error("Orca's plugin catalog is off"))
    }
    const seeded = super
      .seedOfficialSource()
      .then((state) => this.restoreRemovedOfficialSource(state))
    this.officialRestore = seeded
    return seeded
  }

  // Why: Orca seeds once per session, so a source removed while the catalog was off would
  // otherwise stay missing until restart after the user turns the catalog back on.
  private async restoreRemovedOfficialSource(
    seeded: PluginMarketplaceSourceState
  ): Promise<PluginMarketplaceSourceState> {
    const sources = await this.catalogStore.listSources()
    if (sources.some((source) => isOfficialMarketplaceGitSource(source.source.url))) {
      return seeded
    }
    const registered = await this.catalogStore.addSource(OFFICIAL_MARKETPLACE_GIT_SOURCE)
    return super.refreshSource(registered.id)
  }

  private async isOfficialSource(sourceId: string): Promise<boolean> {
    const source = (await this.catalogStore.listSources()).find(
      (candidate) => candidate.id === sourceId
    )
    return source !== undefined && isOfficialMarketplaceGitSource(source.source.url)
  }

  // Why: `official` marks a source Orca manages and the UI will not remove; with the catalog
  // off, NASH manages none, so the user can remove a copy they added by hand.
  private projectCatalogState(state: PluginMarketplaceSourceState): PluginMarketplaceSourceState {
    return state.official && !this.isCatalogEnabled() ? { ...state, official: false } : state
  }
}

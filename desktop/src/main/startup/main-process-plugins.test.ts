import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const settingsListeners: ((updates: Record<string, unknown>) => void)[] = []
  const settings: Record<string, unknown> = {}
  return {
    settingsListeners,
    settings,
    app: {
      isPackaged: true,
      getPath: () => '/tmp/nash-plugins-test',
      getVersion: () => '0.0.0-test',
      getAppPath: () => '/tmp/nash-app'
    },
    killListRefresh: vi.fn(async () => ({ version: 1, generatedAt: '', plugins: [] })),
    killListInitialize: vi.fn(async () => {}),
    seedOfficialSource: vi.fn(async () => ({})),
    pluginServiceInitialize: vi.fn(async () => {}),
    bundledBootstrapRequest: vi.fn(async () => null),
    state: {
      store: {
        getSettings: () => settings,
        onSettingsChanged: (listener: (updates: Record<string, unknown>) => void) => {
          settingsListeners.push(listener)
        }
      },
      keybindings: { getOverrides: () => ({}) },
      pluginKillListService: null as unknown,
      pluginMarketplaceService: null as unknown,
      pluginMarketplaceInstaller: null as unknown,
      pluginService: null as unknown
    }
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('../plugins/plugin-service', () => ({
  PluginService: class {
    initialize = mocks.pluginServiceInitialize
    onChanged = vi.fn()
    getDiscovered = (): unknown[] => []
    reconcileActivationState = vi.fn(async () => {})
    refresh = vi.fn(async () => {})
    emitEvent = vi.fn()
  }
}))
vi.mock('../plugins/plugin-kill-list-service', () => ({
  PluginKillListService: class {
    initialize = mocks.killListInitialize
    refresh = mocks.killListRefresh
    onChanged = vi.fn()
    find = (): null => null
    reason = (): null => null
  }
}))
vi.mock('../plugins/plugin-marketplace-service', () => ({
  PluginMarketplaceService: class {
    seedOfficialSource = mocks.seedOfficialSource
  }
}))
vi.mock('../plugins/plugin-marketplace-installer', () => ({ PluginMarketplaceInstaller: class {} }))
vi.mock('../plugins/plugin-bundled-bootstrap-coordinator', () => ({
  PluginBundledBootstrapCoordinator: class {
    request = mocks.bundledBootstrapRequest
  }
}))
vi.mock('../plugins/plugin-discovery', () => ({ getPluginsDataDir: () => '/tmp/nash-plugins' }))
vi.mock('../plugins/plugin-bundled-bootstrap', () => ({ resolveBundledPluginRoot: () => null }))
vi.mock('../plugins/plugin-host-process', () => ({ resolvePluginHostEntryPath: () => '/tmp/h' }))
vi.mock('../plugins/plugin-enablement', () => ({
  applyPluginConsent: vi.fn(),
  applyPluginEnablement: vi.fn()
}))
vi.mock('../runtime/rpc/methods/plugins', () => ({ setPluginServiceForRpc: vi.fn() }))
vi.mock('../plugins/plugin-agent-status-event', () => ({
  projectPluginAgentStatusChangedPayload: () => null
}))
vi.mock('../i18n/main-i18n', () => ({
  setMainPluginLanguagePacks: () => false,
  setMainUiLanguage: vi.fn(async () => {})
}))
vi.mock('../menu/register-app-menu', () => ({ rebuildAppMenu: vi.fn() }))
vi.mock('./startup-diagnostics', () => ({ logStartupMilestone: vi.fn() }))
vi.mock('../agent-hooks/server', () => ({ agentHookServer: { subscribeEnrichedStatus: vi.fn() } }))
vi.mock('./main-process-pty-startup', () => ({ emitPluginWorktreeLifecycle: vi.fn() }))
vi.mock('./main-process-state', () => ({ mainProcessState: mocks.state }))

import { initializeMainProcessPlugins } from './main-process-plugins'
import { OrcaPluginCatalogMarketplaceService } from './orca-plugin-catalog-adapter'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

const runtime = { onWorktreeLifecycle: vi.fn() }

async function startPlugins(): Promise<void> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the startup only calls onWorktreeLifecycle on the runtime.
  await initializeMainProcessPlugins(runtime as unknown as OrcaRuntimeService)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// Mirrors the store: settings are saved first, then listeners get the update.
async function changeSettings(updates: Record<string, unknown>): Promise<void> {
  Object.assign(mocks.settings, updates)
  for (const listener of mocks.settingsListeners) {
    listener(updates)
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settingsListeners.length = 0
  for (const key of Object.keys(mocks.settings)) {
    delete mocks.settings[key]
  }
  Object.assign(mocks.settings, {
    pluginSystemEnabled: true,
    uiLanguage: 'en',
    useOrcaPluginCatalog: false
  })
  mocks.app.isPackaged = true
})

describe('plugin startup in NASH builds (Orca cloud services off)', () => {
  it('fetches no Orca safety list and clones no official marketplace at startup', async () => {
    await startPlugins()

    expect(mocks.killListRefresh).not.toHaveBeenCalled()
    expect(mocks.seedOfficialSource).not.toHaveBeenCalled()
  })

  it('makes no Orca plugin request when the plugin system is turned on', async () => {
    await startPlugins()
    await changeSettings({ pluginSystemEnabled: true })

    expect(mocks.killListRefresh).not.toHaveBeenCalled()
    expect(mocks.seedOfficialSource).not.toHaveBeenCalled()
  })

  it('treats a profile saved before the catalog switch existed as opted out', async () => {
    delete mocks.settings.useOrcaPluginCatalog

    await startPlugins()

    expect(mocks.killListRefresh).not.toHaveBeenCalled()
    expect(mocks.seedOfficialSource).not.toHaveBeenCalled()
  })

  it('keeps the local plugin system: cached safety list, discovery and bundled plugins', async () => {
    await startPlugins()

    expect(mocks.killListInitialize).toHaveBeenCalledOnce()
    expect(mocks.pluginServiceInitialize).toHaveBeenCalledOnce()
    expect(mocks.bundledBootstrapRequest).toHaveBeenCalled()
  })

  it('serves marketplaces through the catalog adapter so source removal follows the switch', async () => {
    await startPlugins()

    expect(mocks.state.pluginMarketplaceService).toBeInstanceOf(OrcaPluginCatalogMarketplaceService)
  })
})

describe("Orca's plugin catalog opt-in (D-039)", () => {
  it('seeds the official marketplace and refreshes the safety list at startup', async () => {
    mocks.settings.useOrcaPluginCatalog = true

    await startPlugins()

    expect(mocks.seedOfficialSource).toHaveBeenCalledOnce()
    expect(mocks.killListRefresh).toHaveBeenCalledOnce()
  })

  it('waits for the plugin system, then uses the catalog when it is turned on', async () => {
    Object.assign(mocks.settings, { pluginSystemEnabled: false, useOrcaPluginCatalog: true })
    await startPlugins()
    expect(mocks.seedOfficialSource).not.toHaveBeenCalled()
    expect(mocks.killListRefresh).not.toHaveBeenCalled()

    await changeSettings({ pluginSystemEnabled: true })

    expect(mocks.seedOfficialSource).toHaveBeenCalledOnce()
    expect(mocks.killListRefresh).toHaveBeenCalledOnce()
  })

  it('seeds and refreshes when the user turns the catalog on at runtime', async () => {
    await startPlugins()

    await changeSettings({ useOrcaPluginCatalog: true })

    expect(mocks.seedOfficialSource).toHaveBeenCalledOnce()
    expect(mocks.killListRefresh).toHaveBeenCalledOnce()
  })

  it('does nothing when the catalog is turned on while the plugin system is off', async () => {
    mocks.settings.pluginSystemEnabled = false
    await startPlugins()

    await changeSettings({ useOrcaPluginCatalog: true })

    expect(mocks.seedOfficialSource).not.toHaveBeenCalled()
    expect(mocks.killListRefresh).not.toHaveBeenCalled()
  })

  it('requests each once when one update turns on both the plugin system and the catalog', async () => {
    mocks.settings.pluginSystemEnabled = false
    await startPlugins()

    await changeSettings({ pluginSystemEnabled: true, useOrcaPluginCatalog: true })

    expect(mocks.seedOfficialSource).toHaveBeenCalledOnce()
    expect(mocks.killListRefresh).toHaveBeenCalledOnce()
  })

  it('stops seeding and refreshing after the user turns the catalog off', async () => {
    mocks.settings.useOrcaPluginCatalog = true
    await startPlugins()

    await changeSettings({ useOrcaPluginCatalog: false })
    await changeSettings({ pluginSystemEnabled: false })
    await changeSettings({ pluginSystemEnabled: true })

    expect(mocks.seedOfficialSource).toHaveBeenCalledOnce()
    expect(mocks.killListRefresh).toHaveBeenCalledOnce()
  })

  it("keeps Orca's rule that a development build never fetches the safety list", async () => {
    mocks.app.isPackaged = false
    mocks.settings.useOrcaPluginCatalog = true

    await startPlugins()

    expect(mocks.seedOfficialSource).toHaveBeenCalledOnce()
    expect(mocks.killListRefresh).not.toHaveBeenCalled()
  })
})

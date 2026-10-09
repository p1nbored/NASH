import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

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
    constructor(readonly options: { pluginsDataDir: string }) {}
    initialize = mocks.killListInitialize
    refresh = mocks.killListRefresh
    onChanged = vi.fn()
    find = (): null => null
    reason = (): null => null
  }
}))
vi.mock('../plugins/plugin-marketplace-service', () => ({
  PluginMarketplaceService: class {
    constructor(readonly options: { pluginsDataDir: string }) {}
    seedOfficialSource = mocks.seedOfficialSource
  }
}))
vi.mock('../plugins/plugin-marketplace-installer', () => ({
  PluginMarketplaceInstaller: class {
    constructor(readonly options: { userDataPath: string }) {}
  }
}))
vi.mock('../plugins/plugin-bundled-bootstrap-coordinator', () => ({
  PluginBundledBootstrapCoordinator: class {
    request = mocks.bundledBootstrapRequest
  }
}))
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

describe('native official plugin catalog startup', () => {
  it('stores catalog, safety data and installed plugins under the current NASH userData root', async () => {
    await startPlugins()
    const data = { options: { pluginsDataDir: join('/tmp/nash-plugins-test', 'plugins-data') } }
    expect(mocks.state.pluginMarketplaceService).toMatchObject(data)
    expect(mocks.state.pluginKillListService).toMatchObject(data)
    expect(mocks.state.pluginMarketplaceInstaller).toMatchObject({
      options: { userDataPath: '/tmp/nash-plugins-test' }
    })
  })

  it.each([false, true, undefined])(
    'seeds the catalog and refreshes safety data regardless of obsolete opt-in %s',
    async (savedOptIn) => {
      if (savedOptIn === undefined) {
        delete mocks.settings.useOrcaPluginCatalog
      } else {
        mocks.settings.useOrcaPluginCatalog = savedOptIn
      }
      await startPlugins()
      expect(mocks.seedOfficialSource).toHaveBeenCalledOnce()
      expect(mocks.killListRefresh).toHaveBeenCalledOnce()
    }
  )

  it('waits for the plugin system and starts the catalog when enabled', async () => {
    mocks.settings.pluginSystemEnabled = false
    await startPlugins()
    expect(mocks.seedOfficialSource).not.toHaveBeenCalled()
    expect(mocks.killListRefresh).not.toHaveBeenCalled()
    await changeSettings({ pluginSystemEnabled: true })
    expect(mocks.seedOfficialSource).toHaveBeenCalledOnce()
    expect(mocks.killListRefresh).toHaveBeenCalledOnce()
  })

  it('keeps discovery, cached safety data and bundled plugin bootstrap', async () => {
    await startPlugins()
    expect(mocks.killListInitialize).toHaveBeenCalledOnce()
    expect(mocks.pluginServiceInitialize).toHaveBeenCalledOnce()
    expect(mocks.bundledBootstrapRequest).toHaveBeenCalled()
  })

  it('does not fetch the safety feed in development builds', async () => {
    mocks.app.isPackaged = false
    await startPlugins()
    expect(mocks.seedOfficialSource).toHaveBeenCalledOnce()
    expect(mocks.killListRefresh).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const settingsListeners: ((updates: Record<string, unknown>) => void)[] = []
  return {
    settingsListeners,
    killListRefresh: vi.fn(async () => ({ version: 1, generatedAt: '', plugins: [] })),
    killListInitialize: vi.fn(async () => {}),
    seedOfficialSource: vi.fn(async () => ({})),
    pluginServiceInitialize: vi.fn(async () => {}),
    bundledBootstrapRequest: vi.fn(async () => null),
    state: {
      store: {
        getSettings: () => ({ pluginSystemEnabled: true, uiLanguage: 'en' }),
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
  app: {
    isPackaged: true,
    getPath: () => '/tmp/nash-plugins-test',
    getVersion: () => '0.0.0-test',
    getAppPath: () => '/tmp/nash-app'
  },
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
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

const runtime = { onWorktreeLifecycle: vi.fn() }

async function startPlugins(): Promise<void> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the startup only calls onWorktreeLifecycle on the runtime.
  await initializeMainProcessPlugins(runtime as unknown as OrcaRuntimeService)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('plugin startup in NASH builds (Orca cloud services off)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settingsListeners.length = 0
  })

  it('fetches no Orca safety list and clones no official marketplace at startup', async () => {
    await startPlugins()

    expect(mocks.killListRefresh).not.toHaveBeenCalled()
    expect(mocks.seedOfficialSource).not.toHaveBeenCalled()
  })

  it('makes no Orca plugin request when the plugin system is turned on', async () => {
    await startPlugins()
    for (const listener of mocks.settingsListeners) {
      listener({ pluginSystemEnabled: true })
    }
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.killListRefresh).not.toHaveBeenCalled()
    expect(mocks.seedOfficialSource).not.toHaveBeenCalled()
  })

  it('keeps the local plugin system: cached safety list, discovery and bundled plugins', async () => {
    await startPlugins()

    expect(mocks.killListInitialize).toHaveBeenCalledOnce()
    expect(mocks.pluginServiceInitialize).toHaveBeenCalledOnce()
    expect(mocks.bundledBootstrapRequest).toHaveBeenCalled()
  })
})

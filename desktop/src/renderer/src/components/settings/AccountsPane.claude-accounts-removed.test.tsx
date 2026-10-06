// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { AccountsPane } from './AccountsPane'

// FIXTURE_ONLY: an older host that still publishes a Claude roster; every IPC read is a spy and
// window.api has no claudeAccounts, so any Claude account call would throw.
const fake = vi.hoisted(() => ({
  write: vi.fn(),
  cursorStatus: vi.fn(),
  grokStatus: vi.fn(),
  zcodeStatus: vi.fn(),
  opencodeStatus: vi.fn(),
  watcher: vi.fn(
    (_settings: unknown, handlers: { onSnapshot: (snapshot: Record<string, unknown>) => void }) => {
      handlers.onSnapshot({
        claude: {
          accounts: [
            {
              id: 'fixture-claude',
              email: 'fixture-claude@example.invalid',
              authMethod: 'subscription-oauth',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            }
          ],
          activeAccountId: 'fixture-claude'
        },
        codex: { accounts: [], activeAccountId: null },
        rateLimits: null
      })
      return { close: vi.fn() }
    }
  )
}))
vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback
    )
}))
vi.mock('@/lib/agent-catalog', () => ({ AgentIcon: () => null }))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settingsSearchQuery: '',
      rateLimits: {
        codex: null,
        codexTarget: { runtime: 'host', wslDistro: null },
        minimax: null,
        cursor: null,
        grok: null,
        zcode: null,
        usageMetersDisabled: true
      },
      runtimeEnvironments: [],
      refreshRateLimits: fake.write,
      refreshGrokRateLimits: fake.write,
      recordFeatureInteraction: fake.write,
      fetchSettings: fake.write
    })
}))
vi.mock('@/runtime/runtime-provider-accounts-client', () => ({
  emptyCodexAccountsState: () => ({
    accounts: [],
    activeAccountId: null,
    activeAccountIdsByRuntime: { host: null, wsl: {} }
  }),
  hasRemoteProviderAccountOwner: () => false,
  watchProviderAccounts: fake.watcher,
  selectCodexProviderAccount: fake.write,
  removeCodexProviderAccount: fake.write
}))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, {
    api: {
      opencodeGoCredentials: { getStatus: fake.opencodeStatus },
      minimaxCredentials: {
        getStatus: vi.fn(async () => ({ cookieConfigured: false, apiKeyConfigured: false }))
      },
      zcodePlanCredentials: { getStatus: fake.zcodeStatus },
      codexConfigSync: {
        status: vi.fn(async () => ({ state: 'synced', reason: null, systemConfigPath: '/x' }))
      },
      codexAccounts: {
        getPendingLoginUrl: vi.fn(async () => null),
        onPendingLoginUrlChanged: vi.fn(() => vi.fn())
      },
      cursorAccounts: { getStatus: fake.cursorStatus },
      grokAccounts: { getStatus: fake.grokStatus }
    }
  })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'api')
})

it('renders no Claude account controls without CLI readings, while Codex and agy stay', async () => {
  render(<AccountsPane settings={getDefaultSettings('/synthetic')} updateSettings={fake.write} />)
  await act(async () => {})

  expect(document.getElementById('accounts-claude')).toBeNull()
  expect(screen.queryByText('Claude Accounts')).toBeNull()
  expect(screen.queryByText('Claude', { exact: true })).toBeNull()
  expect(screen.queryByText('fixture-claude@example.invalid')).toBeNull()
  expect(screen.queryByRole('dialog', { name: 'Remove Claude Account?' })).toBeNull()
  expect(document.getElementById('accounts-codex')).not.toBeNull()
  expect(document.getElementById('accounts-antigravity')).not.toBeNull()
})

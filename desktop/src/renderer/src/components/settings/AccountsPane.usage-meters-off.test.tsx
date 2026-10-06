// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { AccountsPane } from './AccountsPane'

// FIXTURE_ONLY: a host that keeps Orca's usage meters off (NASH); every IPC read is a spy.
const fake = vi.hoisted(() => ({
  write: vi.fn(),
  watcher: vi.fn(() => ({ close: vi.fn() })),
  cursorStatus: vi.fn(),
  grokStatus: vi.fn(),
  zcodeStatus: vi.fn(),
  opencodeStatus: vi.fn()
}))
vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback
    )
}))
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

it('replaces the usage-only provider sections with one note and reads none of their sign-ins', async () => {
  render(<AccountsPane settings={getDefaultSettings('/synthetic')} updateSettings={fake.write} />)
  await act(async () => {})
  expect(screen.getByText('Usage is not shown in NASH')).toBeTruthy()
  for (const title of ['Gemini CLI (legacy)', 'OpenCode Go', 'MiniMax', 'Grok (xAI)', 'Cursor']) {
    expect(screen.queryByText(title, { exact: true })).toBeNull()
  }
  expect(screen.queryByText('GLM Coding Plan', { exact: true })).toBeNull()
  // Why: Claude account switching is removed, so Claude has no Accounts section of its own.
  expect(screen.queryByText('Claude', { exact: true })).toBeNull()
  expect(screen.getByText('Codex', { exact: true })).toBeTruthy()
  expect(fake.cursorStatus).not.toHaveBeenCalled()
  expect(fake.grokStatus).not.toHaveBeenCalled()
  expect(fake.zcodeStatus).not.toHaveBeenCalled()
  expect(fake.opencodeStatus).not.toHaveBeenCalled()
})

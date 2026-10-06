// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { AccountsPane } from './AccountsPane'

// FIXTURE_ONLY: a NASH host that reads Claude, Codex and agy usage through the CLIs; every IPC
// read is a spy.
const fake = vi.hoisted(() => ({
  write: vi.fn(),
  refresh: vi.fn(async () => {}),
  watcher: vi.fn(() => ({ close: vi.fn() })),
  cursorStatus: vi.fn(),
  grokStatus: vi.fn(),
  zcodeStatus: vi.fn(),
  opencodeStatus: vi.fn()
}))

function reading(
  provider: 'claude' | 'codex',
  source: 'cli' | 'live-session',
  usedPercent: number
): ProviderRateLimits {
  return {
    provider,
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: Date.now() - 2 * 60_000,
    error: null,
    status: 'ok',
    usageMetadata: { source }
  }
}

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
      usagePercentageDisplay: 'used',
      rateLimits: {
        claude: reading('claude', 'live-session', 42),
        codex: reading('codex', 'cli', 17),
        antigravity: null,
        codexTarget: { runtime: 'host', wslDistro: null },
        minimax: null,
        cursor: null,
        grok: null,
        zcode: null,
        usageMetersDisabled: true,
        cliUsageReadings: true
      },
      runtimeEnvironments: [],
      refreshRateLimits: fake.refresh,
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

it('shows the Claude, Codex and agy readings with their source and time', async () => {
  render(<AccountsPane settings={getDefaultSettings('/synthetic')} updateSettings={fake.write} />)
  await act(async () => {})
  const section = screen.getByTestId('cli-usage-readings')
  expect(section.textContent).toContain('Usage from the CLIs')
  expect(section.textContent).toContain('From Claude Code status line')
  expect(section.textContent).toContain('From codex app-server')
  expect(section.textContent).toContain('Updated 2m ago')
  expect(section.textContent).toContain('42% used')
  expect(section.textContent).toContain('No reading yet')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
  expect(fake.refresh).toHaveBeenCalledTimes(1)
})

it('hides the Claude account switcher and keeps Codex accounts and the off-provider note', async () => {
  render(<AccountsPane settings={getDefaultSettings('/synthetic')} updateSettings={fake.write} />)
  await act(async () => {})
  expect(document.getElementById('accounts-claude')).toBeNull()
  expect(screen.queryByText('Claude Accounts')).toBeNull()
  expect(document.getElementById('accounts-codex')).not.toBeNull()
  expect(document.getElementById('accounts-antigravity')).not.toBeNull()
  expect(screen.getByText('Usage is not shown in NASH')).toBeTruthy()
  expect(fake.cursorStatus).not.toHaveBeenCalled()
  expect(fake.grokStatus).not.toHaveBeenCalled()
})

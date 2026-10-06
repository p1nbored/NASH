import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import {
  getVisibleUsageProvider,
  isUsageEmptyState,
  usageProviderSettingsFor,
  type UsageProviderSettings
} from './status-bar-provider-visibility'
import { getUsageReadingSourceLabel } from './usage-reading-source'
import { usageRowMenuKind } from './status-bar-usage-row-menu'

// FIXTURE_ONLY: a NASH host that reads Claude, Codex and agy usage through the CLIs themselves.
const CLI_HOST = createEmptyRateLimitState({
  usageMetersDisabled: true,
  cliUsageReadings: true,
  grokAuthConfigured: true,
  minimaxCookieConfigured: true
})

const SETTINGS: Partial<UsageProviderSettings> = {
  geminiCliOAuthEnabled: true,
  opencodeSessionCookie: 'fixture-cookie',
  codexManagedAccounts: [
    {
      id: 'codex-account-1',
      email: 'dev@example.com',
      managedHomePath: '/tmp/codex-account-1',
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    }
  ]
}

function reading(
  provider: ProviderRateLimits['provider'],
  source: 'cli' | 'live-session' | 'oauth' | undefined
): ProviderRateLimits {
  return {
    provider,
    session: { usedPercent: 40, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 1_000,
    error: null,
    status: 'ok',
    ...(source ? { usageMetadata: { source } } : {})
  }
}

describe('status bar on CLI usage readings', () => {
  const settings = usageProviderSettingsFor({
    settings: SETTINGS,
    rateLimits: CLI_HOST,
    antigravityUsageConfigured: true
  })

  it('earns meters only for Claude, Codex and agy', () => {
    expect(settings).not.toBeNull()
    expect(getVisibleUsageProvider('codex', null, settings)?.status).toBe('fetching')
    expect(getVisibleUsageProvider('antigravity', null, settings)?.status).toBe('fetching')
    for (const off of ['gemini', 'opencode-go', 'grok', 'minimax', 'cursor', 'zcode'] as const) {
      expect(getVisibleUsageProvider(off, null, settings)).toBeNull()
    }
  })

  it('shows Claude only once its status line reported, with no waiting skeleton', () => {
    expect(getVisibleUsageProvider('claude', null, settings)).toBeNull()
    const claude = reading('claude', 'live-session')
    expect(getVisibleUsageProvider('claude', claude, settings)).toBe(claude)
  })

  it('never shows the account setup prompt', () => {
    expect(isUsageEmptyState({ ...CLI_HOST }, settings)).toBe(false)
  })

  it('keeps every meter hidden on a host whose meters are simply off', () => {
    const offHost = createEmptyRateLimitState({ usageMetersDisabled: true })
    expect(
      usageProviderSettingsFor({
        settings: SETTINGS,
        rateLimits: offHost,
        antigravityUsageConfigured: true
      })
    ).toBeNull()
  })
})

describe('getUsageReadingSourceLabel', () => {
  it('names the CLI feed each reading came from', () => {
    expect(getUsageReadingSourceLabel(reading('claude', 'live-session'))).toBe(
      'Claude Code status line'
    )
    expect(getUsageReadingSourceLabel(reading('codex', 'cli'))).toBe('codex app-server')
    expect(getUsageReadingSourceLabel(reading('antigravity', 'cli'))).toBe('agy /usage')
  })

  it('names nothing for a reading that did not come from a CLI feed', () => {
    expect(getUsageReadingSourceLabel(reading('claude', 'oauth'))).toBeNull()
    expect(getUsageReadingSourceLabel(reading('codex', undefined))).toBeNull()
    expect(getUsageReadingSourceLabel(reading('gemini', 'cli'))).toBeNull()
  })
})

describe('usageRowMenuKind', () => {
  it('has no Claude account switcher and keeps the Codex one', () => {
    expect(usageRowMenuKind('claude')).toBe('details')
    expect(usageRowMenuKind('codex')).toBe('codex-switcher')
    expect(usageRowMenuKind('antigravity')).toBe('details')
    expect(usageRowMenuKind('gemini')).toBe('details')
  })
})

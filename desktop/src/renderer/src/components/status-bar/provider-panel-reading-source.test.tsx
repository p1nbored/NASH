import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { ProviderPanel } from './tooltip'

vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback
    )
}))
vi.mock('@/lib/agent-catalog', () => ({ AgentIcon: () => null }))

// FIXTURE_ONLY: readings as the three CLI feeds publish them.
function reading(
  provider: ProviderRateLimits['provider'],
  source: 'cli' | 'live-session' | undefined
): ProviderRateLimits {
  return {
    provider,
    session: { usedPercent: 40, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: Date.now() - 3 * 60_000,
    error: null,
    status: 'ok',
    ...(source ? { usageMetadata: { source } } : {})
  }
}

describe('ProviderPanel reading source', () => {
  it('says which CLI feed the reading came from, next to its time', () => {
    const claude = renderToStaticMarkup(<ProviderPanel p={reading('claude', 'live-session')} />)
    expect(claude).toContain('From Claude Code status line')
    expect(claude).toContain('Updated 3m ago')
    expect(renderToStaticMarkup(<ProviderPanel p={reading('codex', 'cli')} />)).toContain(
      'From codex app-server'
    )
    expect(renderToStaticMarkup(<ProviderPanel p={reading('antigravity', 'cli')} />)).toContain(
      'From agy /usage'
    )
  })

  it('names no source for a reading without one', () => {
    expect(renderToStaticMarkup(<ProviderPanel p={reading('codex', undefined)} />)).not.toContain(
      'From '
    )
  })
})

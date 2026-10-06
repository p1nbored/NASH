import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits, RateLimitWindow } from '../../../shared/rate-limit-types'
import { STALE_THRESHOLD_MS } from '../../rate-limits/service/service-types'
import { providerHeadroomFrom } from './route-provider-headroom'

const NOW = Date.parse('2026-10-04T12:00:00.000Z')
const LATER = NOW + 60 * 60_000
const EARLIER = NOW - 60 * 60_000

function window(usedPercent: number, resetsAt: number | null = LATER): RateLimitWindow {
  return { usedPercent, windowMinutes: 300, resetsAt, resetDescription: null }
}

function limits(
  provider: ProviderRateLimits['provider'],
  overrides: Partial<ProviderRateLimits> = {}
): ProviderRateLimits {
  return {
    provider,
    session: window(20),
    weekly: window(40),
    updatedAt: NOW,
    error: null,
    status: 'ok',
    ...overrides
  }
}

function reading(
  claude: ProviderRateLimits | null,
  codex: ProviderRateLimits | null = limits('codex'),
  antigravity: ProviderRateLimits | null = limits('antigravity')
) {
  return providerHeadroomFrom({ claude, codex, antigravity }, NOW)
}

function headroom(
  claude: ProviderRateLimits | null,
  codex: ProviderRateLimits | null = limits('codex'),
  antigravity: ProviderRateLimits | null = limits('antigravity')
) {
  return reading(claude, codex, antigravity).headroom
}

describe('providerHeadroomFrom (G8b observation only)', () => {
  it('reports headroom for each provider whose windows all have room', () => {
    expect(reading(limits('claude'))).toEqual({
      headroom: { claude: true, codex: true, agy: true },
      unobserved: []
    })
  })

  it('maps antigravity state to the agy pool and keeps claude and codex apart', () => {
    expect(headroom(limits('claude'), limits('codex', { session: window(100) }))).toEqual({
      claude: true,
      codex: false,
      agy: true
    })
    expect(
      headroom(limits('claude'), limits('codex'), limits('antigravity', { weekly: window(100) }))
    ).toEqual({ claude: true, codex: true, agy: false })
  })

  it.each([
    ['the session window', { session: window(100) }],
    ['the weekly window', { weekly: window(100) }],
    ['the monthly window', { monthly: window(100) }],
    ['a named bucket', { buckets: [{ name: 'pool', ...window(100) }] }],
    ['a window past 100 percent', { session: window(130) }]
  ])('reports no headroom when %s is exhausted', (_label, overrides) => {
    const result = reading(limits('claude', overrides))
    expect(result.headroom.claude).toBe(false)
    expect(result.unobserved).toEqual([])
  })

  it('treats a window just under the limit as headroom', () => {
    expect(headroom(limits('claude', { session: window(99.9) })).claude).toBe(true)
  })

  it('ignores an exhausted window whose reset time has already passed', () => {
    expect(headroom(limits('claude', { session: window(100, EARLIER) })).claude).toBe(true)
  })

  it('keeps an exhausted window with an unknown reset time exhausted', () => {
    expect(headroom(limits('claude', { session: window(100, null) })).claude).toBe(false)
  })

  it('does not let the model-specific Fable window block account-wide headroom', () => {
    expect(headroom(limits('claude', { fableWeekly: window(100) })).claude).toBe(true)
  })

  it('keeps headroom while a refresh is fetching and the windows are known', () => {
    const result = reading(limits('claude', { status: 'fetching' }))
    expect(result.headroom.claude).toBe(true)
    expect(result.unobserved).toEqual([])
  })
})

describe('providerHeadroomFrom: a reading that survives a failed refresh', () => {
  it('keeps recent windows observed through a transient error', () => {
    const result = reading(
      limits('claude', { status: 'error', error: 'offline', updatedAt: NOW - 60_000 })
    )
    expect(result.headroom.claude).toBe(true)
    expect(result.unobserved).toEqual([])
  })

  it('still blocks on an exhausted window that an error status kept', () => {
    const result = reading(
      limits('claude', {
        status: 'error',
        error: '429',
        session: window(100),
        updatedAt: NOW - 60_000
      })
    )
    expect(result.headroom.claude).toBe(false)
    expect(result.unobserved).toEqual([])
  })

  it('counts an error with no windows as unobserved', () => {
    const result = reading(
      limits('claude', { status: 'error', error: 'offline', session: null, weekly: null })
    )
    expect(result).toEqual({
      headroom: { claude: true, codex: true, agy: true },
      unobserved: ['claude']
    })
  })
})

describe('providerHeadroomFrom: how old a reading may be', () => {
  it('treats an ok snapshot older than the stale threshold as unobserved', () => {
    const result = reading(limits('claude', { updatedAt: NOW - STALE_THRESHOLD_MS - 1 }))
    expect(result).toEqual({
      headroom: { claude: true, codex: true, agy: true },
      unobserved: ['claude']
    })
  })

  it('keeps a snapshot exactly at the stale threshold observed', () => {
    const result = reading(limits('claude', { updatedAt: NOW - STALE_THRESHOLD_MS }))
    expect(result.unobserved).toEqual([])
  })

  it('does not let an old exhausted snapshot count as evidence of exhaustion', () => {
    const result = reading(
      limits('claude', { session: window(100), updatedAt: NOW - STALE_THRESHOLD_MS - 1 })
    )
    expect(result.headroom.claude).toBe(true)
    expect(result.unobserved).toEqual(['claude'])
  })

  it('applies the same age limit to a snapshot kept through an error', () => {
    const result = reading(
      limits('claude', {
        status: 'error',
        error: 'offline',
        updatedAt: NOW - STALE_THRESHOLD_MS - 1
      })
    )
    expect(result.unobserved).toEqual(['claude'])
  })

  it('counts a snapshot with no usable timestamp as unobserved', () => {
    expect(reading(limits('claude', { updatedAt: Number.NaN })).unobserved).toEqual(['claude'])
  })
})

describe('providerHeadroomFrom: unobserved is not a block', () => {
  it.each([
    ['no state for the provider', null],
    ['an unavailable status', limits('claude', { status: 'unavailable' })],
    ['an idle status that never fetched', limits('claude', { status: 'idle' })],
    ['an ok status with no window', limits('claude', { session: null, weekly: null })],
    [
      'a first fetch still running with no window yet',
      limits('claude', { status: 'fetching', session: null, weekly: null })
    ]
  ])('reports headroom and lists the pool as unobserved for %s', (_label, state) => {
    expect(reading(state)).toEqual({
      headroom: { claude: true, codex: true, agy: true },
      unobserved: ['claude']
    })
  })

  it('lists the unobserved pools in the fixed pool order', () => {
    expect(reading(null, null, null).unobserved).toEqual(['claude', 'codex', 'agy'])
    expect(
      reading(limits('claude'), null, limits('antigravity', { status: 'idle' })).unobserved
    ).toEqual(['codex', 'agy'])
  })

  it('reports every pool unobserved, and none blocked, when the rate-limit service has no state', () => {
    expect(providerHeadroomFrom(null, NOW)).toEqual({
      headroom: { claude: true, codex: true, agy: true },
      unobserved: ['claude', 'codex', 'agy']
    })
  })

  it('still blocks one exhausted pool while another is unobserved', () => {
    expect(reading(null, limits('codex', { session: window(100) }))).toEqual({
      headroom: { claude: true, codex: false, agy: true },
      unobserved: ['claude']
    })
  })
})

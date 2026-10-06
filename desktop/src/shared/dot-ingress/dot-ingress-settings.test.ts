import { describe, expect, it } from 'vitest'
import {
  DotAllowedWorkspaceSchema,
  DotIngressSettingsViewSchema,
  DotRateLimitsSchema
} from './dot-ingress-settings'

// FIXTURE_ONLY: synthetic ids.
const entry = {
  workspaceRef: 'dws_0123456789abcdef01234567',
  workspaceId: 'repo::/work/billing',
  label: 'billing',
  enabled: true
}
const settings = {
  enabled: false,
  connection: 'not_connected',
  rateLimits: { ratePerMinute: 6, ratePerUtcDay: 100 },
  updatedAt: null,
  workspaces: [entry]
}

describe('DotIngressSettingsViewSchema (desktop only)', () => {
  it('can never claim that a dot is connected', () => {
    expect(DotIngressSettingsViewSchema.parse(settings)).toEqual(settings)
    for (const connection of ['connected', 'online', 'ready', 'verified']) {
      expect(DotIngressSettingsViewSchema.safeParse({ ...settings, connection }).success).toBe(
        false
      )
    }
  })

  it('has no confirmation mode: dot tasks start without the user confirming each one', () => {
    for (const field of ['confirmation', 'confirmationRequired', 'requireConfirmation']) {
      expect(
        DotIngressSettingsViewSchema.safeParse({ ...settings, [field]: 'required' }).success
      ).toBe(false)
    }
  })

  it('shows the Workbench workspace id to the desktop only, with a path-free label', () => {
    expect(DotAllowedWorkspaceSchema.safeParse(entry).success).toBe(true)
    expect(DotAllowedWorkspaceSchema.safeParse({ ...entry, label: 'a/b' }).success).toBe(false)
    expect(DotAllowedWorkspaceSchema.safeParse({ ...entry, workspaceId: '  ' }).success).toBe(false)
    expect(DotAllowedWorkspaceSchema.safeParse({ ...entry, token: 'x' }).success).toBe(false)
  })
})

describe('DotRateLimitsSchema', () => {
  it('accepts whole numbers within the contract bounds', () => {
    expect(DotRateLimitsSchema.safeParse({ ratePerMinute: 1, ratePerUtcDay: 1 }).success).toBe(true)
    expect(
      DotRateLimitsSchema.safeParse({ ratePerMinute: 60, ratePerUtcDay: 10_000 }).success
    ).toBe(true)
  })

  it.each([
    [{ ratePerMinute: 0, ratePerUtcDay: 100 }],
    [{ ratePerMinute: 61, ratePerUtcDay: 100 }],
    [{ ratePerMinute: 6, ratePerUtcDay: 0 }],
    [{ ratePerMinute: 6, ratePerUtcDay: 10_001 }],
    [{ ratePerMinute: 1.5, ratePerUtcDay: 100 }],
    [{ ratePerMinute: 6 }],
    [{ ratePerMinute: 6, ratePerUtcDay: 100, extra: 1 }]
  ])('refuses %j', (value) => {
    expect(DotRateLimitsSchema.safeParse(value).success).toBe(false)
  })
})

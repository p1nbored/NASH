import { describe, expect, it } from 'vitest'
import {
  WorkbenchRoutingStatusViewSchema,
  parseWorkbenchRoutingStatusView,
  type WorkbenchRoutingStatusView
} from './workbench-routing-status-view'

const BUNDLE_SHA = '6'.repeat(64)
const READY: WorkbenchRoutingStatusView = {
  status: 'ready',
  dispatch: false,
  credentials: { tokenPresent: true, accountPresent: true, protection: 'sealed' },
  profile: {
    present: true,
    verifiedAt: '2026-10-04T11:00:00.000Z',
    verifiedAgainstBundleSha256: BUNDLE_SHA
  },
  bundle: {
    sha256: BUNDLE_SHA
  }
}

describe('workbench routing status view', () => {
  it('accepts a complete secret-free view', () => {
    expect(parseWorkbenchRoutingStatusView(READY)).toEqual(READY)
  })

  it('accepts a paused configuration status', () => {
    const blocked: WorkbenchRoutingStatusView = {
      ...READY,
      status: 'quota_latched',
      profile: {
        present: false,
        verifiedAt: null,
        verifiedAgainstBundleSha256: null
      }
    }
    expect(parseWorkbenchRoutingStatusView(blocked)).toEqual(blocked)
  })

  it.each([undefined, null, 'ready', [], {}])('rejects a value that is not a view: %j', (value) => {
    expect(parseWorkbenchRoutingStatusView(value)).toBeNull()
  })

  it('rejects an unknown routing status and a malformed verification time', () => {
    expect(parseWorkbenchRoutingStatusView({ ...READY, status: 'connected' })).toBeNull()
    expect(
      parseWorkbenchRoutingStatusView({
        ...READY,
        profile: { ...READY.profile, verifiedAt: 'tomorrow' }
      })
    ).toBeNull()
  })

  // Why: D-022 removed every Clef spend cap, so a status naming one is not this contract.
  it('has no spend caps and no budget status', () => {
    expect(Object.keys(READY)).not.toContain('caps')
    expect(parseWorkbenchRoutingStatusView({ ...READY, status: 'budget_unset' })).toBeNull()
    const olderBuild = {
      ...READY,
      caps: {
        production: { attemptsPerRequestCap: 2 },
        verification: { capMicroUsd: 5_000_000, spentMicroUsd: 0, remainingMicroUsd: 5_000_000 }
      }
    }
    expect(parseWorkbenchRoutingStatusView(olderBuild)).toBeNull()
  })

  it('carries the hashes that determine whether a stored verification still applies', () => {
    const otherBundle = {
      ...READY,
      status: 'contract_unverified',
      profile: {
        present: false,
        verifiedAt: null,
        verifiedAgainstBundleSha256: '5'.repeat(64)
      }
    }
    expect(parseWorkbenchRoutingStatusView(otherBundle)).toEqual(otherBundle)
  })

  it('rejects bundle facts outside the contract', () => {
    const { bundle } = READY
    for (const wrong of [
      { ...bundle, sha256: 'not-a-hash' },
      { ...bundle, questionSetVersion: 2 },
      { ...bundle, thresholds: { delegationTrueMin: 0.6 } },
      { ...bundle, awaitingUserConfirmation: [] },
      { ...bundle, taskTypeOptions: { software_engineering: 'FIXTURE_ONLY' } }
    ]) {
      expect(parseWorkbenchRoutingStatusView({ ...READY, bundle: wrong })).toBeNull()
    }
    const badPin = { ...READY.profile, verifiedAgainstBundleSha256: 'abc' }
    expect(parseWorkbenchRoutingStatusView({ ...READY, profile: badPin })).toBeNull()
    const { bundle: _omitted, ...withoutBundle } = READY
    expect(parseWorkbenchRoutingStatusView(withoutBundle)).toBeNull()
  })

  // Why: a field the contract does not name could carry a credential value, so every level is strict.
  it.each([
    ['top level', (view: WorkbenchRoutingStatusView) => ({ ...view, token: 'FIXTURE_ONLY' })],
    [
      'credentials',
      (view: WorkbenchRoutingStatusView) => ({
        ...view,
        credentials: { ...view.credentials, accountId: 'FIXTURE_ONLY' }
      })
    ],
    [
      'profile',
      (view: WorkbenchRoutingStatusView) => ({
        ...view,
        profile: { ...view.profile, reportSha256: 'FIXTURE_ONLY' }
      })
    ],
    [
      'bundle',
      (view: WorkbenchRoutingStatusView) => ({
        ...view,
        bundle: { ...view.bundle, url: 'FIXTURE_ONLY' }
      })
    ]
  ])('rejects an extra field at the %s', (_label, widen) => {
    expect(WorkbenchRoutingStatusViewSchema.safeParse(widen(READY)).success).toBe(false)
  })
})

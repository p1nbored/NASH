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
    responseModelPinned: true,
    verifiedAt: '2026-10-04T11:00:00.000Z',
    verifiedAgainstBundleSha256: BUNDLE_SHA
  },
  bundle: {
    questionSetVersion: 2,
    taxonomyVersion: 2,
    sha256: BUNDLE_SHA,
    thresholds: { delegationTrueMin: 0.6, delegationFalseMax: 0.4, taskTypeMarginMin: 0.1 },
    awaitingUserConfirmation: ['thresholds', 'task_type_options', 'needs_delegation_criteria']
  },
  latches: { authFailed: false, quotaLatchedUntil: null },
  circuit: { state: 'closed', reopensAt: null, consecutiveTransient: 0 }
}

describe('workbench routing status view', () => {
  it('accepts a complete secret-free view', () => {
    expect(parseWorkbenchRoutingStatusView(READY)).toEqual(READY)
  })

  it('accepts active latch and circuit times', () => {
    const blocked: WorkbenchRoutingStatusView = {
      ...READY,
      status: 'quota_latched',
      profile: {
        present: false,
        responseModelPinned: false,
        verifiedAt: null,
        verifiedAgainstBundleSha256: null
      },
      latches: { authFailed: true, quotaLatchedUntil: '2026-10-05T00:00:00.000Z' },
      circuit: {
        state: 'open',
        reopensAt: '2026-10-04T12:05:00.000Z',
        consecutiveTransient: 3
      }
    }
    expect(parseWorkbenchRoutingStatusView(blocked)).toEqual(blocked)
  })

  it.each([undefined, null, 'ready', [], {}])('rejects a value that is not a view: %j', (value) => {
    expect(parseWorkbenchRoutingStatusView(value)).toBeNull()
  })

  it('rejects an unknown routing status, a negative count and a malformed time', () => {
    expect(parseWorkbenchRoutingStatusView({ ...READY, status: 'connected' })).toBeNull()
    expect(
      parseWorkbenchRoutingStatusView({
        ...READY,
        circuit: { ...READY.circuit, consecutiveTransient: -1 }
      })
    ).toBeNull()
    expect(
      parseWorkbenchRoutingStatusView({
        ...READY,
        latches: { authFailed: false, quotaLatchedUntil: 'tomorrow' }
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

  it('carries the question bundle facts and the bundle a stored profile was verified against', () => {
    const otherBundle = {
      ...READY,
      status: 'contract_unverified',
      profile: {
        present: false,
        responseModelPinned: false,
        verifiedAt: null,
        verifiedAgainstBundleSha256: '5'.repeat(64)
      },
      bundle: { ...READY.bundle, awaitingUserConfirmation: [] }
    }
    expect(parseWorkbenchRoutingStatusView(otherBundle)).toEqual(otherBundle)
  })

  it('rejects bundle facts outside the contract', () => {
    const { bundle } = READY
    for (const wrong of [
      { ...bundle, sha256: 'not-a-hash' },
      { ...bundle, questionSetVersion: 0 },
      { ...bundle, thresholds: { ...bundle.thresholds, delegationTrueMin: 1.5 } },
      { ...bundle, thresholds: { ...bundle.thresholds, text: 'FIXTURE_ONLY' } },
      { ...bundle, awaitingUserConfirmation: ['budget'] },
      { ...bundle, awaitingUserConfirmation: ['thresholds', 'thresholds'] },
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
      'latches',
      (view: WorkbenchRoutingStatusView) => ({
        ...view,
        latches: { ...view.latches, url: 'FIXTURE_ONLY' }
      })
    ],
    [
      'circuit',
      (view: WorkbenchRoutingStatusView) => ({
        ...view,
        circuit: { ...view.circuit, probeUrl: 'FIXTURE_ONLY' }
      })
    ]
  ])('rejects an extra field at the %s', (_label, widen) => {
    expect(WorkbenchRoutingStatusViewSchema.safeParse(widen(READY)).success).toBe(false)
  })
})

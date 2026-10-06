import type { PreloadApi } from '../../../src/preload/api-types'
import type { WorkbenchRoutingStatusView } from '../../../src/shared/clef/workbench-routing-status-view'
import {
  FIXTURE_OTHER_BUNDLE_SHA,
  fixtureCallFailed,
  fixturePinnedProfile,
  fixturePinResult,
  fixtureReported,
  fixtureStatus
} from '../../../src/renderer/src/components/settings/clef-verification.test-fixture'
import type { SettingsFixtureReply } from './scenario-settings-routing-table'

// FIXTURE_ONLY Clef status, Verify and Pin answers. No credential value exists here: the fixture
// reports presence flags only, and Verify never leaves the page. No budget or cost (D-022). The
// bundle facts come from the status view; `?clef=otherBundle` names a profile for another bundle.
export const CLEF_FIXTURE_VARIANTS = [
  'unverified',
  'notPinnable',
  'callFailed',
  'refused',
  'pinned',
  'unconfigured',
  'paused',
  'unavailable',
  'otherBundle'
] as const
export type ClefFixtureVariant = (typeof CLEF_FIXTURE_VARIANTS)[number]

export function readClefFixtureVariant(search: string): ClefFixtureVariant {
  const value = new URLSearchParams(search).get('clef')
  return CLEF_FIXTURE_VARIANTS.find((variant) => variant === value) ?? 'unverified'
}

function initialStatus(variant: ClefFixtureVariant): WorkbenchRoutingStatusView {
  if (variant === 'pinned') {
    return fixtureStatus({ status: 'ready', profile: fixturePinnedProfile() })
  }
  if (variant === 'otherBundle') {
    // Why: a profile pinned for an earlier bundle no longer applies, so routing reads unverified.
    return fixtureStatus({
      profile: {
        present: false,
        responseModelPinned: false,
        verifiedAt: null,
        verifiedAgainstBundleSha256: FIXTURE_OTHER_BUNDLE_SHA
      }
    })
  }
  if (variant === 'unconfigured') {
    return fixtureStatus({
      status: 'not_configured',
      credentials: { tokenPresent: false, accountPresent: false, protection: 'absent' }
    })
  }
  if (variant === 'paused') {
    return fixtureStatus({
      status: 'circuit_open',
      circuit: { state: 'open', reopensAt: '2026-10-05T10:17:00Z', consecutiveTransient: 3 }
    })
  }
  return fixtureStatus()
}

function verifyReply(variant: ClefFixtureVariant): SettingsFixtureReply {
  switch (variant) {
    case 'notPinnable':
      return {
        ok: true,
        result: fixtureReported({
          pin: { pinnable: false, problems: ['option_ids_not_echoed', 'usage_missing'] }
        })
      }
    case 'callFailed':
      return { ok: true, result: fixtureCallFailed() }
    case 'refused':
      // Why: a pause that begins after the status read is a refusal the UI cannot foresee.
      return {
        ok: false,
        code: 'workbench_clef_circuit_open',
        message: 'FIXTURE_ONLY refusal'
      }
    case 'unverified':
    case 'pinned':
    case 'unconfigured':
    case 'paused':
    case 'unavailable':
    case 'otherBundle':
      return { ok: true, result: fixtureReported() }
  }
}

export function createClefFixture(
  variant: ClefFixtureVariant
): (method: string, params: unknown) => SettingsFixtureReply | null {
  let status = initialStatus(variant)
  return (method) => {
    if (variant === 'unavailable' && method.startsWith('workbench.')) {
      if (method === 'workbench.routing.status' || method.startsWith('workbench.clef.')) {
        return {
          ok: false,
          code: 'workbench_routing_not_configured',
          message: 'FIXTURE_ONLY routing not configured'
        }
      }
    }
    switch (method) {
      case 'workbench.routing.status':
        return { ok: true, result: status }
      case 'workbench.clef.verify':
        return verifyReply(variant)
      case 'workbench.clef.profile.pin':
        status = { ...status, status: 'ready', profile: fixturePinnedProfile() }
        return { ok: true, result: fixturePinResult() }
      default:
        return null
    }
  }
}

/** Presence and protection only, matching the variant; the harness holds no token or account id. */
export function createClefCredentialsFixture(
  variant: ClefFixtureVariant
): PreloadApi['clefCredentials'] {
  const stored = variant !== 'unconfigured'
  const status = {
    tokenPresent: stored,
    accountPresent: stored,
    protection: stored ? ('sealed' as const) : ('absent' as const)
  }
  return {
    status: () => Promise.resolve(status),
    save: () => Promise.resolve({ ok: false, code: 'write_failed', status }),
    clear: () => Promise.resolve({ ok: false, code: 'clear_failed', status })
  }
}

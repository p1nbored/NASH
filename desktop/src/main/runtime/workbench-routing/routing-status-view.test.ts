import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { parseWorkbenchRoutingStatusView } from '../../../shared/clef/workbench-routing-status-view'
import { CLEF_QUESTION_BUNDLE_SHA256 } from '../../clef/clef-question-set'
import { CLEF_SCHEMA_PINS, createPinCheckedProfileSource } from '../../clef/clef-schema-pins'
import { readRoutingStatusView } from './routing-status-view'
import { createWorkbenchRoutingRuntime } from './workbench-routing-runtime'
import {
  FIXTURE_ONLY_PRINCIPAL,
  FIXTURE_ONLY_WORKSPACE,
  createRuntimeHarness,
  type RuntimeHarness
} from './workbench-runtime.test-fixture'
import {
  FIXTURE_ONLY_ACCOUNT_ID,
  FIXTURE_ONLY_BEARER,
  FIXTURE_ONLY_SEALED_STATUS,
  fixtureProfileRecord
} from './workbench-routing.test-fixture'

let harness: RuntimeHarness | null = null

function setup(options: Parameters<typeof createRuntimeHarness>[0] = {}) {
  harness = createRuntimeHarness(options)
  const active = harness
  const view = (dispatch = false) =>
    readRoutingStatusView(active.deps, { dispatch, storedProfile: active.admin.profileStore })
  return { harness: active, view }
}

const FIXTURE_INPUT_PIN = 'b'.repeat(64)
const BUNDLE_FACTS = {
  sha256: CLEF_QUESTION_BUNDLE_SHA256
}

afterEach(() => {
  harness?.close()
  harness = null
})

describe('readRoutingStatusView', () => {
  it('reports a configured install with no spend cap and no dispatch', () => {
    const { view } = setup()
    expect(view()).toEqual({
      status: 'ready',
      dispatch: false,
      credentials: { tokenPresent: true, accountPresent: true, protection: 'sealed' },
      profile: {
        present: true,
        verifiedAt: '2026-10-04T11:00:00.000Z',
        verifiedAgainstBundleSha256: FIXTURE_INPUT_PIN
      },
      bundle: BUNDLE_FACTS
    })
  })

  it('reports the verification hash without the removed advanced diagnostics', () => {
    const { view } = setup()
    expect(view().bundle).toEqual(BUNDLE_FACTS)
    expect(view()).not.toHaveProperty('circuit')
    expect(view()).not.toHaveProperty('latches')
  })

  it('names the bundle a stored profile was verified against, even when it no longer applies', () => {
    const { harness: h } = setup()
    const other = '5'.repeat(64)
    const stored = fixtureProfileRecord({
      schemaPins: { ...CLEF_SCHEMA_PINS, inputSchemaSha256: other }
    })
    const deps = {
      ...h.deps,
      verifiedProfile: createPinCheckedProfileSource({ read: () => stored })
    }

    const result = readRoutingStatusView(deps, {
      dispatch: false,
      storedProfile: { read: () => stored }
    })

    expect(result.status).toBe('contract_unverified')
    expect(result.profile).toEqual({
      present: false,
      verifiedAt: null,
      verifiedAgainstBundleSha256: other
    })
    expect(result.bundle.sha256).toBe(CLEF_QUESTION_BUNDLE_SHA256)
  })

  it('reports no verified bundle when no profile is stored or the file cannot be read', () => {
    const { harness: h, view } = setup()
    h.setProfile(null)
    expect(view().profile.verifiedAgainstBundleSha256).toBeNull()
    const unreadable = readRoutingStatusView(h.deps, {
      dispatch: false,
      storedProfile: {
        read: () => {
          throw new Error('EBUSY: fixture disk error')
        }
      }
    })
    expect(unreadable.profile.verifiedAgainstBundleSha256).toBeNull()
  })

  it('reads the stored profile through the administration store the runtime is given', () => {
    const { harness: h } = setup()
    const runtime = createWorkbenchRoutingRuntime({ ...h.deps, admin: h.admin })
    expect(runtime.routingStatusView().profile.verifiedAgainstBundleSha256).toBe(FIXTURE_INPUT_PIN)
    expect(runtime.routingStatusView().bundle).toEqual(BUNDLE_FACTS)
  })

  it('always satisfies the shared strict parser the renderer uses', () => {
    const { view } = setup()
    expect(parseWorkbenchRoutingStatusView(view())).toEqual(view())
  })

  it('carries the dispatch flag the runtime reports and does not decide it', () => {
    const { view } = setup()
    expect(view(true).dispatch).toBe(true)
    expect(view(false).dispatch).toBe(false)
  })

  it('reports the configuration gate that stops routing, in G0 order', () => {
    const { harness: h, view } = setup()
    h.credentials.setStatus({ tokenPresent: false, accountPresent: false, protection: 'absent' })
    expect(view().status).toBe('not_configured')
    h.credentials.setStatus(FIXTURE_ONLY_SEALED_STATUS)
    h.setProfile(null)
    expect(view().status).toBe('contract_unverified')
    expect(view().profile).toEqual({
      present: false,
      verifiedAt: null,
      verifiedAgainstBundleSha256: null
    })
  })

  it('stays ready however much was spent, and shows no spend figure (D-022)', () => {
    const { harness: h, view } = setup()
    // Why a stored request: the spend table keeps a foreign key to the request it was reserved for.
    const { requestId } = h.requests.submit(
      FIXTURE_ONLY_PRINCIPAL,
      {
        workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId,
        objective: 'Plan the retry button.',
        idempotencyKey: randomUUID()
      },
      FIXTURE_ONLY_WORKSPACE
    ).request
    const production = h.routes.spend.atomically(() =>
      h.ledger.reserve({ requestId, purpose: 'production', estimatedInputTokens: 1_000_000 })
    )
    expect(production.ok).toBe(true)
    for (let index = 0; index < 20; index += 1) {
      const verification = h.routes.spend.atomically(() =>
        h.ledger.reserve({
          requestId: null,
          purpose: 'verification',
          estimatedInputTokens: 1_000_000
        })
      )
      expect(verification.ok).toBe(true)
    }
    expect(h.ledger.snapshot().verificationMicroUsdSpent).toBeGreaterThan(5_000_000)
    const after = view()
    expect(after.status).toBe('ready')
    expect(Object.keys(after)).not.toContain('caps')
    expect(JSON.stringify(after)).not.toMatch(/micro|neuron|spent|remaining|cost/i)
  })

  it('reports an auth latch until the credentials change', () => {
    const { harness: h, view } = setup()
    h.circuit.record('auth_failed', h.credentials.generation())
    expect(view().status).toBe('auth_failed')
    h.credentials.rotate()
    expect(view().status).toBe('ready')
  })

  it('reports a quota latch through the configuration status', () => {
    const { harness: h, view } = setup()
    h.circuit.record('quota_latched', h.credentials.generation())
    expect(view().status).toBe('quota_latched')
  })

  it('reports an open circuit through the configuration status', () => {
    const { harness: h, view } = setup()
    const generation = h.credentials.generation()
    for (let strike = 0; strike < 3; strike += 1) {
      h.circuit.record('transient_exhausted', generation)
    }
    expect(view().status).toBe('circuit_open')
  })

  it('reports unreachable after a first transient failure', () => {
    const { harness: h, view } = setup()
    h.circuit.record('transient_exhausted', h.credentials.generation())
    expect(view().status).toBe('unreachable')
  })

  it('never carries a credential, account id, URL or profile hash', () => {
    const { harness: h, view } = setup()
    h.circuit.record('auth_failed', h.credentials.generation())
    const result = view()
    const text = JSON.stringify(result)
    expect(text).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
    expect(text).not.toContain(FIXTURE_ONLY_BEARER)
    expect(text).not.toContain(FIXTURE_ONLY_BEARER.replace('Bearer ', ''))
    expect(text).not.toMatch(/https?:\/\//)
    expect(text).not.toContain(fixtureProfileRecord().profileHash)
    expect(text).not.toContain(fixtureProfileRecord().profile.reportSha256)
    // Why: the only hashes allowed are the public question-bundle hashes; nothing else may look like an id.
    const withoutBundleHashes = JSON.stringify({
      ...result,
      bundle: { ...result.bundle, sha256: '' },
      profile: { ...result.profile, verifiedAgainstBundleSha256: null }
    })
    expect(withoutBundleHashes).not.toMatch(/[0-9a-f]{32}/)
  })

  it('reads only local state: it makes no call and reserves nothing', () => {
    const { harness: h, view } = setup()
    view()
    view()
    expect(h.transport).not.toHaveBeenCalled()
    expect(h.spendRows()).toEqual([])
  })
})

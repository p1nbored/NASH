// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { ClefVerificationSection } from './clef-verification-section'
import {
  FIXTURE_BUNDLE_SHA,
  FIXTURE_OTHER_BUNDLE_SHA,
  FIXTURE_REPORT_SHA,
  fixtureBundle,
  fixtureCallFailed,
  fixturePinResult,
  fixturePinnedProfile,
  fixtureReported,
  fixtureStatus
} from './clef-verification.test-fixture'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})

// Why: D-022 shows no Clef budget or cost, so no money word or figure may appear anywhere here.
const MONEY = /\$|budget|cost|reserve|billed|spend/i

function answer(byMethod: Record<string, unknown>): void {
  rpc.mockImplementation(async (_target, method) => {
    if (!(method in byMethod)) {
      throw new Error(`unexpected method ${method}`)
    }
    const value = byMethod[method]
    if (value instanceof Error) {
      throw value
    }
    return value
  })
}

function callsTo(method: string): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === method).map((call) => call[2])
}

async function renderSection(): Promise<HTMLElement> {
  render(<ClefVerificationSection />)
  await act(async () => {})
  return screen.getByRole('region', { name: 'Verification and response profile' })
}

async function runVerify(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
  })
}

describe('ClefVerificationSection', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows an unpinned profile and the bundle version, and no cost or budget', async () => {
    answer({ 'workbench.routing.status': fixtureStatus() })
    const section = await renderSection()

    expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.routing.status', undefined)
    const facts = within(section).getByRole('list', { name: 'Verification status' })
    expect(within(facts).getByText('Not verified')).toBeTruthy()
    expect(within(facts).getByText('Question set 2, taxonomy 2')).toBeTruthy()
    expect(within(facts).queryByText(/Next Verify/)).toBeNull()
    expect(section.textContent).not.toMatch(MONEY)
  })

  it('shows the defaults awaiting confirmation as neutral information, not a warning', async () => {
    answer({ 'workbench.routing.status': fixtureStatus() })
    const section = await renderSection()

    const pending = within(section).getByRole('note', { name: 'Awaiting your confirmation' })
    expect(pending.textContent).toMatch(/0\.60 or more/)
    expect(pending.textContent).toMatch(/0\.40 or less/)
    expect(pending.textContent).toMatch(/0\.10/)
    expect(pending.textContent).toMatch(/11 task-type options and the 2 delegation answers/)
    expect(pending.className).not.toMatch(/warning|destructive/)
    expect(within(section).queryByRole('alert')).toBeNull()
  })

  it('runs Verify as soon as it is clicked, with no cost confirmation', async () => {
    answer({
      'workbench.routing.status': fixtureStatus(),
      'workbench.clef.verify': fixtureReported()
    })
    await renderSection()

    await runVerify()

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(callsTo('workbench.clef.verify')).toEqual([{}])
  })

  it('shows a pinnable report with no cost line and pins it by its hash alone', async () => {
    answer({
      'workbench.routing.status': fixtureStatus(),
      'workbench.clef.verify': fixtureReported(),
      'workbench.clef.profile.pin': fixturePinResult()
    })
    const section = await renderSection()
    await runVerify()

    const report = within(section).getByRole('group', { name: 'Verification report' })
    expect(report.textContent).toMatch(/HTTP 200/)
    expect(report.textContent).toMatch(/@cf\/cloudflare\/clef/)
    expect(report.textContent).toMatch(/Report format 2/)
    expect(report.textContent).not.toMatch(MONEY)
    await act(async () => {
      fireEvent.click(within(report).getByRole('button', { name: 'Pin profile' }))
    })

    expect(callsTo('workbench.clef.profile.pin')).toEqual([{ reportSha256: FIXTURE_REPORT_SHA }])
    expect(within(section).getByRole('status').textContent).toMatch(/Profile pinned/)
  })

  it('lists why a report cannot be pinned and offers no pin', async () => {
    answer({
      'workbench.routing.status': fixtureStatus(),
      'workbench.clef.verify': fixtureReported({
        pin: { pinnable: false, problems: ['option_ids_not_echoed', 'usage_missing'] }
      })
    })
    const section = await renderSection()
    await runVerify()

    const report = within(section).getByRole('group', { name: 'Verification report' })
    expect(within(report).getAllByRole('listitem', { name: undefined }).length).toBeGreaterThan(0)
    expect(report.textContent).toMatch(/option IDs/i)
    expect(report.textContent).toMatch(/token usage/i)
    expect(within(report).queryByRole('button', { name: 'Pin profile' })).toBeNull()
  })

  it('explains a failed call with its blocker in plain English and no cost', async () => {
    answer({
      'workbench.routing.status': fixtureStatus(),
      'workbench.clef.verify': fixtureCallFailed()
    })
    const section = await renderSection()
    await runVerify()

    const failure = within(section).getByRole('group', { name: 'Verification call failed' })
    expect(failure.textContent).toMatch(/credentials or account/i)
    expect(failure.textContent).not.toMatch(/auth_or_account/)
    expect(failure.textContent).not.toMatch(MONEY)
  })

  it('explains a refused Verify without repeating the raw error', async () => {
    answer({
      'workbench.routing.status': fixtureStatus(),
      'workbench.clef.verify': new RuntimeRpcCallError({
        id: 'rpc-1',
        ok: false,
        error: { code: 'workbench_clef_circuit_open', message: 'raw text' }
      })
    })
    const section = await renderSection()
    await runVerify()

    const alert = within(section).getByRole('alert')
    expect(alert.textContent).toMatch(/paused/i)
    expect(alert.textContent).not.toContain('raw text')
  })

  it('keeps Verify disabled until sealed credentials are saved, and says why', async () => {
    answer({
      'workbench.routing.status': fixtureStatus({
        status: 'not_configured',
        credentials: { tokenPresent: false, accountPresent: false, protection: 'absent' }
      })
    })
    const section = await renderSection()

    expect(screen.getByRole('button', { name: 'Verify' })).toHaveProperty('disabled', true)
    expect(within(section).getByText(/Save the API token and account ID/)).toBeTruthy()
  })

  it('keeps Verify disabled while Clef calls are paused', async () => {
    answer({ 'workbench.routing.status': fixtureStatus({ status: 'circuit_open' }) })
    const section = await renderSection()

    expect(screen.getByRole('button', { name: 'Verify' })).toHaveProperty('disabled', true)
    expect(within(section).getByText(/Verify is paused/)).toBeTruthy()
  })

  it('shows a pinned profile with its verification time when routing is ready', async () => {
    answer({
      'workbench.routing.status': fixtureStatus({
        status: 'ready',
        profile: fixturePinnedProfile()
      })
    })
    const section = await renderSection()

    const facts = within(section).getByRole('list', { name: 'Verification status' })
    expect(within(facts).getByText(/^Pinned/)).toBeTruthy()
    expect(within(facts).getByText('Ready')).toBeTruthy()
    expect(section.textContent).not.toMatch(/different bundle/i)
  })

  it('says when the stored profile was verified against a different question bundle', async () => {
    answer({
      'workbench.routing.status': fixtureStatus({
        profile: {
          present: false,
          responseModelPinned: false,
          verifiedAt: null,
          verifiedAgainstBundleSha256: FIXTURE_OTHER_BUNDLE_SHA
        }
      })
    })
    const section = await renderSection()

    const facts = within(section).getByRole('list', { name: 'Verification status' })
    const note = within(facts).getByText(/Profile verified against a different bundle/)
    expect(note.textContent).toContain(FIXTURE_OTHER_BUNDLE_SHA.slice(0, 12))
    expect(note.textContent).toContain(FIXTURE_BUNDLE_SHA.slice(0, 12))
  })

  it('says verification is unavailable when routing is not installed', async () => {
    answer({
      'workbench.routing.status': new RuntimeRpcCallError({
        id: 'rpc-1',
        ok: false,
        error: { code: 'workbench_routing_not_configured', message: 'raw text' }
      })
    })
    const section = await renderSection()

    expect(within(section).getByRole('alert').textContent).toMatch(/not available/i)
    expect(screen.getByRole('button', { name: 'Verify' })).toHaveProperty('disabled', true)
  })
})

describe('ClefVerificationSection bundle facts from the status view', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('reads the question set and taxonomy versions main reports', async () => {
    answer({
      'workbench.routing.status': fixtureStatus({
        bundle: fixtureBundle({ questionSetVersion: 3, taxonomyVersion: 4 })
      })
    })
    const section = await renderSection()

    const facts = within(section).getByRole('list', { name: 'Verification status' })
    expect(within(facts).getByText('Question set 3, taxonomy 4')).toBeTruthy()
  })

  it('shows the thresholds main reports and only the values still awaiting confirmation', async () => {
    answer({
      'workbench.routing.status': fixtureStatus({
        bundle: fixtureBundle({
          thresholds: { delegationTrueMin: 0.7, delegationFalseMax: 0.3, taskTypeMarginMin: 0.15 },
          awaitingUserConfirmation: ['thresholds']
        })
      })
    })
    const section = await renderSection()

    const pending = within(section).getByRole('note', { name: 'Awaiting your confirmation' })
    expect(pending.textContent).toMatch(/0\.70 or more/)
    expect(pending.textContent).toMatch(/0\.30 or less/)
    expect(pending.textContent).toMatch(/0\.15/)
    expect(pending.textContent).not.toMatch(/task-type options/)
  })

  it('shows no pending note once every bundle value is confirmed', async () => {
    answer({
      'workbench.routing.status': fixtureStatus({
        bundle: fixtureBundle({ awaitingUserConfirmation: [] })
      })
    })
    const section = await renderSection()

    expect(within(section).queryByRole('note', { name: 'Awaiting your confirmation' })).toBeNull()
  })

  it('shows no bundle facts when the status cannot be read', async () => {
    answer({ 'workbench.routing.status': new Error('FIXTURE_ONLY failure') })
    const section = await renderSection()

    expect(within(section).queryByText(/Question set/)).toBeNull()
    expect(within(section).queryByRole('note', { name: 'Awaiting your confirmation' })).toBeNull()
  })
})

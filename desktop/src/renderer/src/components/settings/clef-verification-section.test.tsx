// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { ClefVerificationSection } from './clef-verification-section'
import {
  FIXTURE_OTHER_BUNDLE_SHA,
  FIXTURE_PROFILE_HASH,
  FIXTURE_REPORT_SHA,
  fixtureCallFailed,
  fixturePinResult,
  fixturePinnedProfile,
  fixtureReported,
  fixtureStatus
} from './clef-verification.test-fixture'
import { useClefVerification } from './use-clef-verification'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)
const clipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>())

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

function Harness(): React.JSX.Element {
  return <ClefVerificationSection model={useClefVerification()} />
}

async function renderSection(): Promise<HTMLElement> {
  render(<Harness />)
  await act(async () => {})
  return screen.getByRole('region', { name: 'Verification' })
}

async function runVerify(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
  })
}

async function copiedDetails(scope: HTMLElement): Promise<string> {
  await act(async () => {
    fireEvent.click(within(scope).getByRole('button', { name: 'Copy details' }))
  })
  return clipboard.mock.calls.at(-1)?.[0] ?? ''
}

describe('ClefVerificationSection', () => {
  beforeEach(() => {
    rpc.mockReset()
    clipboard.mockReset()
    clipboard.mockResolvedValue(undefined)
    Object.assign(window, { api: { ui: { writeClipboardText: clipboard } } })
  })

  afterEach(() => {
    cleanup()
  })

  it('says where verification stands in one line, with no versions, cost or budget', async () => {
    answer({ 'workbench.routing.status': fixtureStatus() })
    const section = await renderSection()

    expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.routing.status', undefined)
    expect(section.textContent).toMatch(/Run Verify to check that Clef answers/)
    expect(section.textContent).not.toMatch(/Question set|taxonomy|bundle|profile/i)
    expect(section.textContent).not.toMatch(MONEY)
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

  it('shows a usable result in plain words, keeps its facts in the details and uses it by hash', async () => {
    answer({
      'workbench.routing.status': fixtureStatus(),
      'workbench.clef.verify': fixtureReported(),
      'workbench.clef.profile.pin': fixturePinResult()
    })
    const section = await renderSection()
    await runVerify()

    const result = within(section).getByRole('group', { name: 'Verify result' })
    expect(result.textContent).toMatch(/answered in the expected format/)
    expect(result.textContent).not.toMatch(/HTTP|@cf\/|Report format|bytes/)
    expect(result.textContent).not.toMatch(MONEY)
    const details = await copiedDetails(result)
    expect(details).toMatch(/http_status: 200/)
    expect(details).toContain(FIXTURE_REPORT_SHA)
    await act(async () => {
      fireEvent.click(within(result).getByRole('button', { name: 'Use this result' }))
    })

    expect(callsTo('workbench.clef.profile.pin')).toEqual([{ reportSha256: FIXTURE_REPORT_SHA }])
    expect(within(section).getByRole('status').textContent).toMatch(/Result saved/)
    expect(section.textContent).not.toContain(FIXTURE_PROFILE_HASH.slice(0, 12))
  })

  it('lists why a result cannot be used and offers no way to use it', async () => {
    answer({
      'workbench.routing.status': fixtureStatus(),
      'workbench.clef.verify': fixtureReported({
        pin: { pinnable: false, problems: ['option_ids_not_echoed', 'usage_missing'] }
      })
    })
    const section = await renderSection()
    await runVerify()

    const result = within(section).getByRole('group', { name: 'Verify result' })
    expect(within(result).getAllByRole('listitem')).toHaveLength(2)
    expect(result.textContent).toMatch(/option IDs/i)
    expect(result.textContent).toMatch(/token usage/i)
    expect(within(result).queryByRole('button', { name: 'Use this result' })).toBeNull()
  })

  it('explains a failed call with its blocker in plain English and no cost', async () => {
    answer({
      'workbench.routing.status': fixtureStatus(),
      'workbench.clef.verify': fixtureCallFailed()
    })
    const section = await renderSection()
    await runVerify()

    const failure = within(section).getByRole('group', { name: 'Verification failed' })
    expect(failure.textContent).toMatch(/credentials or account/i)
    expect(failure.textContent).not.toMatch(/auth_or_account|HTTP|attempts/)
    expect(failure.textContent).not.toMatch(MONEY)
    expect(await copiedDetails(failure)).toMatch(/blocker: .*auth_or_account/)
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

  it('keeps Verify disabled until the credentials are saved, and says why', async () => {
    answer({
      'workbench.routing.status': fixtureStatus({
        status: 'not_configured',
        credentials: { tokenPresent: false, accountPresent: false, protection: 'absent' }
      })
    })
    const section = await renderSection()

    expect(screen.getByRole('button', { name: 'Verify' })).toHaveProperty('disabled', true)
    expect(within(section).getByText(/Save the API token and account ID first/)).toBeTruthy()
  })

  it('keeps Verify disabled while Clef calls are paused', async () => {
    answer({ 'workbench.routing.status': fixtureStatus({ status: 'circuit_open' }) })
    const section = await renderSection()

    expect(screen.getByRole('button', { name: 'Verify' })).toHaveProperty('disabled', true)
    expect(within(section).getByText(/Verify is paused/)).toBeTruthy()
  })

  it('says when Clef was last verified once it is ready', async () => {
    answer({
      'workbench.routing.status': fixtureStatus({
        status: 'ready',
        profile: fixturePinnedProfile()
      })
    })
    const section = await renderSection()

    expect(section.textContent).toMatch(/Clef can classify tasks/)
    expect(section.textContent).toMatch(/Last verified/)
    expect(section.textContent).not.toMatch(/questions changed/i)
  })

  it('asks to verify again when the questions changed', async () => {
    const status = fixtureStatus({
      profile: {
        present: false,
        verifiedAt: null,
        verifiedAgainstBundleSha256: FIXTURE_OTHER_BUNDLE_SHA
      }
    })
    answer({ 'workbench.routing.status': status })
    const section = await renderSection()

    expect(section.textContent).toMatch(/questions changed since the last verification/)
    expect(section.textContent).not.toContain(FIXTURE_OTHER_BUNDLE_SHA.slice(0, 12))
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

    expect(within(section).getAllByRole('alert')[0].textContent).toMatch(/not available/i)
    expect(screen.getByRole('button', { name: 'Verify' })).toHaveProperty('disabled', true)
  })
})

// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { DOT_REMOTE_OWNER_PAGES } from '../../../../shared/dot-remote/dot-remote-owner-pages'
import { DOT_REMOTE_RPC_ERROR_CODES } from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { DotRemoteAccessCard } from './dot-remote-access-card'
import * as PairingPanel from './dot-remote-pairing-panel'
import {
  FIXTURE_REMOTE_ORIGIN,
  FIXTURE_REMOTE_USER_CODE,
  fixtureConfiguredRemoteStatus,
  fixtureConnectedRemoteStatus,
  fixtureEndedPairing,
  fixtureReconnectRemoteStatus,
  fixtureRemoteStatus,
  fixtureWaitingPairing
} from './dot-remote-access.test-fixture'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})

const NOW = Date.parse('2026-10-05T09:30:00.000Z')
const EXPIRES_AT = new Date(NOW + 10 * 60_000).toISOString()

/** Answers each call with the next value; the last one repeats. */
class Sequence {
  #index = 0
  readonly #values: readonly unknown[]

  constructor(values: readonly unknown[]) {
    this.#values = values
  }

  next(): unknown {
    const value = this.#values[Math.min(this.#index, this.#values.length - 1)]
    this.#index += 1
    return value
  }
}

function sequence(...values: unknown[]): Sequence {
  return new Sequence(values)
}

/** An answer the test releases later, to order a response after other events. */
class Deferred {
  readonly promise: Promise<unknown>
  resolve: (value: unknown) => void = () => {}

  constructor() {
    this.promise = new Promise((resolve) => {
      this.resolve = resolve
    })
  }
}

function answer(byMethod: Record<string, unknown>): void {
  rpc.mockImplementation(async (_target, method) => {
    const entry = byMethod[method]
    if (entry === undefined) {
      throw new Error(`unexpected method ${method}`)
    }
    const value =
      entry instanceof Sequence
        ? entry.next()
        : entry instanceof Deferred
          ? await entry.promise
          : entry
    if (value instanceof RuntimeRpcCallError) {
      throw value
    }
    return value
  })
}

function refuse(code: string): RuntimeRpcCallError {
  return new RuntimeRpcCallError({ id: 't', ok: false, error: { code, message: `raw ${code}` } })
}

function callsTo(method: string): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === method).map((call) => call[2])
}

function card(): HTMLElement {
  const shell = document.querySelector('[data-settings-section="integrations-dot-remote"]')
  if (!(shell instanceof HTMLElement)) {
    throw new Error('remote access card is missing')
  }
  return shell
}

async function renderCard(): Promise<HTMLElement> {
  render(<DotRemoteAccessCard />)
  await act(async () => {})
  return card()
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element)
  })
}

const PAIRING_PAGE = `${FIXTURE_REMOTE_ORIGIN}${DOT_REMOTE_OWNER_PAGES.pairingApproval}`
const startButton = (): HTMLElement => within(card()).getByRole('button', { name: /Start pairing/ })
const codeGroup = (): HTMLElement => within(card()).getByRole('group', { name: 'Pairing code' })
const pollCount = (): number => callsTo('workbench.dotRemote.pairing.status').length

function waitingStart(expiresAt = EXPIRES_AT): unknown {
  return {
    pairing: fixtureWaitingPairing(expiresAt),
    status: fixtureConfiguredRemoteStatus({ state: 'pairing' })
  }
}

describe('DotRemoteAccessCard: pairing and revocation', () => {
  const openUrl = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    rpc.mockReset()
    openUrl.mockClear()
    Object.defineProperty(globalThis, 'api', { configurable: true, value: { shell: { openUrl } } })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Reflect.deleteProperty(globalThis, 'api')
  })

  // Why: the Site serves the page at the path the contract names; a private copy here could drift.
  it('takes the pairing page path from the Site contract instead of keeping its own', () => {
    expect(DOT_REMOTE_OWNER_PAGES.pairingApproval).toBe('/pairing')
    expect(Object.keys(PairingPanel)).not.toContain('DOT_REMOTE_APPROVAL_PAGE_PATH')
  })

  it('offers pairing only once remote access is on and the connection is saved', async () => {
    answer({ 'workbench.dotRemote.status': fixtureRemoteStatus() })
    await renderCard()
    expect(startButton().hasAttribute('disabled')).toBe(true)
    expect(card().textContent).toMatch(/Turn on remote access to pair/)
    cleanup()

    answer({
      'workbench.dotRemote.status': fixtureRemoteStatus({ state: 'unpaired', enabled: true })
    })
    await renderCard()
    expect(startButton().hasAttribute('disabled')).toBe(true)
    expect(card().textContent).toMatch(/Save the Site origin and access token to pair/)
  })

  it('shows the code in large text, the approval page and a countdown, then polls until approved', async () => {
    const waiting = fixtureWaitingPairing(EXPIRES_AT)
    answer({
      'workbench.dotRemote.status': sequence(
        fixtureConfiguredRemoteStatus(),
        fixtureConnectedRemoteStatus()
      ),
      'workbench.dotRemote.pairing.start': {
        pairing: waiting,
        status: fixtureConfiguredRemoteStatus({ state: 'pairing' })
      },
      'workbench.dotRemote.pairing.status': sequence(
        waiting,
        waiting,
        fixtureEndedPairing('paired')
      )
    })
    await renderCard()

    await click(startButton())
    expect(callsTo('workbench.dotRemote.pairing.start')).toEqual([undefined])
    const code = within(codeGroup()).getByText(FIXTURE_REMOTE_USER_CODE)
    expect(code.className).toMatch(/text-2xl/)
    expect(card().textContent).toContain(PAIRING_PAGE)
    expect(card().textContent).toMatch(/Expires in 10:00/)

    await advance(1_000)
    expect(card().textContent).toMatch(/Expires in 9:59/)

    await click(within(card()).getByRole('button', { name: 'Open pairing page' }))
    expect(openUrl).toHaveBeenCalledWith(PAIRING_PAGE)

    await advance(6_000)
    expect(card().textContent).toMatch(/Pairing approved/)
    expect(within(card()).getByText('Connected', { selector: 'span' })).toBeTruthy()
    expect(within(card()).queryByRole('group', { name: 'Pairing code' })).toBeNull()

    const polls = callsTo('workbench.dotRemote.pairing.status').length
    await advance(20_000)
    expect(callsTo('workbench.dotRemote.pairing.status')).toHaveLength(polls)
  })

  it('stops polling an expired pairing and offers a new one', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.pairing.start': {
        pairing: fixtureWaitingPairing(EXPIRES_AT),
        status: fixtureConfiguredRemoteStatus({ state: 'pairing' })
      },
      'workbench.dotRemote.pairing.status': fixtureEndedPairing('expired')
    })
    await renderCard()

    await click(startButton())
    await advance(2_000)

    expect(card().textContent).toMatch(/code expired before it was approved/)
    expect(within(card()).queryByRole('group', { name: 'Pairing code' })).toBeNull()
    expect(startButton().textContent).toMatch(/Start pairing again/)
    const polls = callsTo('workbench.dotRemote.pairing.status').length
    await advance(20_000)
    expect(callsTo('workbench.dotRemote.pairing.status')).toHaveLength(polls)
  })

  it.each([
    ['denied', /denied on the Site/],
    ['failed', /could not be completed/]
  ] as const)('explains a %s pairing', async (state, message) => {
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.pairing.start': {
        pairing: fixtureWaitingPairing(EXPIRES_AT),
        status: fixtureConfiguredRemoteStatus({ state: 'pairing' })
      },
      'workbench.dotRemote.pairing.status': fixtureEndedPairing(state)
    })
    await renderCard()

    await click(startButton())
    await advance(2_000)

    expect(card().textContent).toMatch(message)
    const polls = pollCount()
    await advance(20_000)
    expect(pollCount()).toBe(polls)
  })

  it('drops the approval message once the pairing it describes has ended', async () => {
    answer({
      'workbench.dotRemote.status': sequence(
        fixtureConfiguredRemoteStatus(),
        fixtureConnectedRemoteStatus(),
        fixtureReconnectRemoteStatus('pairing_revoked')
      ),
      'workbench.dotRemote.pairing.start': waitingStart(),
      'workbench.dotRemote.pairing.status': fixtureEndedPairing('paired')
    })
    await renderCard()
    await click(startButton())
    await advance(2_000)
    expect(card().textContent).toMatch(/Pairing approved/)

    await click(within(card()).getByRole('button', { name: 'Refresh' }))

    expect(within(card()).getByText('Pair again', { selector: 'span' })).toBeTruthy()
    expect(card().textContent).not.toMatch(/Pairing approved/)
  })

  it('stops polling when the card closes', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.pairing.start': waitingStart(),
      'workbench.dotRemote.pairing.status': fixtureWaitingPairing(EXPIRES_AT)
    })
    await renderCard()
    await click(startButton())
    const polls = pollCount()

    cleanup()
    await advance(20_000)

    expect(pollCount()).toBe(polls)
  })

  it('ignores a pairing answer that arrives after remote access was turned off', async () => {
    const late = new Deferred()
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.pairing.start': waitingStart(),
      'workbench.dotRemote.pairing.status': late,
      'workbench.dotRemote.disable': fixtureRemoteStatus({ origin: FIXTURE_REMOTE_ORIGIN })
    })
    await renderCard()
    await click(startButton())
    expect(pollCount()).toBe(1)

    await click(within(card()).getByRole('switch', { name: 'Allow remote access' }))
    await act(async () => {
      late.resolve(fixtureWaitingPairing(EXPIRES_AT))
    })
    await advance(20_000)

    expect(pollCount()).toBe(1)
    expect(within(card()).queryByRole('group', { name: 'Pairing code' })).toBeNull()
  })

  it('keeps polling through a failed read and says so until a read succeeds', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.pairing.start': waitingStart(),
      'workbench.dotRemote.pairing.status': sequence(
        refuse(DOT_REMOTE_RPC_ERROR_CODES.unavailable),
        fixtureWaitingPairing(EXPIRES_AT)
      )
    })
    await renderCard()
    await click(startButton())
    expect(within(card()).getByRole('alert').textContent).toMatch(/not running/)

    await advance(2_000)

    expect(within(card()).queryByRole('alert')).toBeNull()
    expect(codeGroup()).toBeTruthy()
  })

  it('says the code has run out while it waits for the Site to confirm', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.pairing.start': waitingStart(new Date(NOW + 3_000).toISOString()),
      'workbench.dotRemote.pairing.status': fixtureWaitingPairing(
        new Date(NOW + 3_000).toISOString()
      )
    })
    await renderCard()
    await click(startButton())
    expect(card().textContent).toMatch(/Expires in 0:03/)

    await advance(4_000)

    expect(card().textContent).toMatch(/The code has expired. Checking with the Site./)
  })

  it('shows the waiting code again when Settings opens during pairing', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus({ state: 'pairing' }),
      'workbench.dotRemote.pairing.status': fixtureWaitingPairing(EXPIRES_AT)
    })
    await renderCard()

    expect(within(codeGroup()).getByText(FIXTURE_REMOTE_USER_CODE)).toBeTruthy()
  })

  it.each([
    [DOT_REMOTE_RPC_ERROR_CODES.siteUnreachable, /could not be reached/],
    [DOT_REMOTE_RPC_ERROR_CODES.pairingRefused, /refused to start pairing/],
    [DOT_REMOTE_RPC_ERROR_CODES.reconnectNeeded, /refused this computer/]
  ])('explains a refused start (%s) in plain English', async (code, message) => {
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.pairing.start': refuse(code)
    })
    await renderCard()

    await click(startButton())

    expect(within(card()).getByRole('alert').textContent).toMatch(message)
    expect(document.body.innerHTML).not.toContain('raw ')
  })

  it('revokes only after one confirmation that names what revoking does and does not stop', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConnectedRemoteStatus(),
      'workbench.dotRemote.revoke': {
        siteConfirmed: true,
        status: fixtureConfiguredRemoteStatus()
      }
    })
    await renderCard()

    await click(within(card()).getByRole('button', { name: 'Revoke pairing' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/stops future remote work/)
    expect(dialog.textContent).toMatch(/does not cancel runs that already started/)
    await click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(callsTo('workbench.dotRemote.revoke')).toEqual([])

    await click(within(card()).getByRole('button', { name: 'Revoke pairing' }))
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke pairing' }))

    expect(callsTo('workbench.dotRemote.revoke')).toEqual([undefined])
    expect(within(card()).getByText('Not paired', { selector: 'span' })).toBeTruthy()
    expect(within(card()).queryByRole('button', { name: 'Revoke pairing' })).toBeNull()
  })

  it('says when the Site could not be told about a revocation', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConnectedRemoteStatus({ state: 'offline' }),
      'workbench.dotRemote.revoke': {
        siteConfirmed: false,
        status: fixtureConfiguredRemoteStatus()
      }
    })
    await renderCard()

    await click(within(card()).getByRole('button', { name: 'Revoke pairing' }))
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke pairing' }))

    expect(card().textContent).toMatch(/Site could not be told/)
  })
})

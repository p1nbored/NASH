// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { DOT_REMOTE_RPC_ERROR_CODES } from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { DotRemoteAccessCard } from './dot-remote-access-card'
import {
  FIXTURE_REMOTE_ORIGIN,
  FIXTURE_REMOTE_TOKEN,
  fixtureConfiguredRemoteStatus,
  fixtureConnectedRemoteStatus,
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

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const EXPIRES_AT = new Date(Date.now() + 10 * 60_000).toISOString()

/** An answer the test releases later, so it can act while the call is still running. */
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
    const value = entry instanceof Deferred ? await entry.promise : entry
    if (value instanceof RuntimeRpcCallError) {
      throw value
    }
    return value
  })
}

function refuse(code: string): RuntimeRpcCallError {
  return new RuntimeRpcCallError({ id: 't', ok: false, error: { code, message: `raw ${code}` } })
}

function card(): HTMLElement {
  const shell = document.querySelector('[data-settings-section="integrations-dot-remote"]')
  if (!(shell instanceof HTMLElement)) {
    throw new Error('remote access card is missing')
  }
  return shell
}

/** The card next to an unrelated control, so a test can move focus away from the card. */
async function renderCard(): Promise<void> {
  render(
    <>
      <button type="button">Elsewhere</button>
      <DotRemoteAccessCard />
    </>
  )
  await act(async () => {})
}

/** A keyboard user: the control holds focus when it is activated. */
async function activate(element: HTMLElement): Promise<void> {
  element.focus()
  await act(async () => {
    fireEvent.click(element)
  })
}

/** Lets Radix finish closing a dialog: it restores focus from a zero-delay timer. */
async function settleDialog(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** What Chromium does when the focused control becomes disabled while a call runs. */
function dropFocus(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}

const elsewhere = (): HTMLElement => screen.getByRole('button', { name: 'Elsewhere' })
const startButton = (): HTMLElement => within(card()).getByRole('button', { name: /Start pairing/ })
const revokeButton = (): HTMLElement =>
  within(card()).getByRole('button', { name: 'Revoke pairing' })
const saveButton = (): HTMLElement =>
  within(card()).getByRole('button', { name: 'Save connection' })
const codeGroup = (): HTMLElement => within(card()).getByRole('group', { name: 'Pairing code' })

function fillConnection(origin: string): void {
  fireEvent.change(within(card()).getByLabelText('Site origin'), { target: { value: origin } })
  fireEvent.change(within(card()).getByLabelText('Site access token'), {
    target: { value: FIXTURE_REMOTE_TOKEN }
  })
}

describe('DotRemoteAccessCard: keyboard focus after an action', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('moves focus to the pairing code once pairing starts', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.pairing.start': {
        pairing: fixtureWaitingPairing(EXPIRES_AT),
        status: fixtureConfiguredRemoteStatus({ state: 'pairing' })
      },
      'workbench.dotRemote.pairing.status': fixtureWaitingPairing(EXPIRES_AT)
    })
    await renderCard()

    await activate(startButton())

    expect(document.activeElement).toBe(codeGroup())
  })

  it('keeps focus on Start pairing when the Site refuses the start', async () => {
    const start = new Deferred()
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.pairing.start': start
    })
    await renderCard()

    await activate(startButton())
    dropFocus()
    await act(async () => {
      start.resolve(refuse(DOT_REMOTE_RPC_ERROR_CODES.pairingRefused))
    })

    expect(document.activeElement).toBe(startButton())
  })

  it('never takes focus back from a control the user moved to while pairing started', async () => {
    const start = new Deferred()
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.pairing.start': start,
      'workbench.dotRemote.pairing.status': fixtureWaitingPairing(EXPIRES_AT)
    })
    await renderCard()

    await activate(startButton())
    elsewhere().focus()
    await act(async () => {
      start.resolve({
        pairing: fixtureWaitingPairing(EXPIRES_AT),
        status: fixtureConfiguredRemoteStatus({ state: 'pairing' })
      })
    })

    expect(codeGroup()).toBeTruthy()
    expect(document.activeElement).toBe(elsewhere())
  })

  it('moves focus to Start pairing after a revoke removes the Revoke button', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConnectedRemoteStatus(),
      'workbench.dotRemote.revoke': { siteConfirmed: true, status: fixtureConfiguredRemoteStatus() }
    })
    await renderCard()

    await activate(revokeButton())
    await activate(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke pairing' })
    )
    await settleDialog()

    expect(within(card()).queryByRole('button', { name: 'Revoke pairing' })).toBeNull()
    expect(document.activeElement).toBe(startButton())
  })

  it('returns focus to Revoke pairing when the confirmation is cancelled', async () => {
    answer({ 'workbench.dotRemote.status': fixtureConnectedRemoteStatus() })
    await renderCard()

    await activate(revokeButton())
    await activate(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await settleDialog()

    expect(document.activeElement).toBe(revokeButton())
  })

  it('keeps focus on Save connection when the saved origin refills the form', async () => {
    answer({
      'workbench.dotRemote.status': fixtureRemoteStatus({ state: 'unpaired', enabled: true }),
      'workbench.dotRemote.setConnection': fixtureConfiguredRemoteStatus()
    })
    await renderCard()

    fillConnection(FIXTURE_REMOTE_ORIGIN)
    await activate(saveButton())

    expect(within(card()).getByText('Token saved')).toBeTruthy()
    expect(document.activeElement).toBe(saveButton())
  })

  it('puts focus back on Save connection when it was dropped while saving', async () => {
    const save = new Deferred()
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.setConnection': save
    })
    await renderCard()

    fillConnection(FIXTURE_REMOTE_ORIGIN)
    await activate(saveButton())
    dropFocus()
    await act(async () => {
      save.resolve(fixtureConfiguredRemoteStatus())
    })

    expect(document.activeElement).toBe(saveButton())
  })

  it('never takes focus back from a control the user moved to while saving', async () => {
    const save = new Deferred()
    answer({
      'workbench.dotRemote.status': fixtureRemoteStatus({ state: 'unpaired', enabled: true }),
      'workbench.dotRemote.setConnection': save
    })
    await renderCard()

    fillConnection(FIXTURE_REMOTE_ORIGIN)
    await activate(saveButton())
    elsewhere().focus()
    await act(async () => {
      save.resolve(fixtureConfiguredRemoteStatus())
    })

    expect(document.activeElement).toBe(elsewhere())
  })
})

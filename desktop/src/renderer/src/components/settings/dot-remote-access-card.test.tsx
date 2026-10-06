// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import {
  DOT_REMOTE_RECONNECT_REASONS,
  DOT_REMOTE_RPC_ERROR_CODES,
  dotRemoteStateOfReason
} from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { DotRemoteAccessCard } from './dot-remote-access-card'
import {
  FIXTURE_REMOTE_ORIGIN,
  FIXTURE_REMOTE_TOKEN,
  fixtureConfiguredRemoteStatus,
  fixtureConnectedRemoteStatus,
  fixtureReconnectRemoteStatus,
  fixtureRemoteStatus
} from './dot-remote-access.test-fixture'
import { dotRemoteReconnectMessage } from './dot-remote-status-messages'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }))

/** Each method answers its value, or a deferred one; a refusal value is thrown. */
function answer(
  byMethod: Record<string, unknown>,
  deferred: Record<string, () => Promise<unknown>> = {}
): void {
  rpc.mockImplementation(async (_target, method) => {
    const later = deferred[method]
    const value = later === undefined ? byMethod[method] : await later()
    if (value === undefined) {
      throw new Error(`unexpected method ${method}`)
    }
    if (value instanceof RuntimeRpcCallError) {
      throw value
    }
    return value
  })
}

function refuse(code: string, data?: unknown): RuntimeRpcCallError {
  return new RuntimeRpcCallError({
    id: 't',
    ok: false,
    error: { code, message: `raw ${code} ${FIXTURE_REMOTE_TOKEN}`, data }
  })
}

function callsTo(method: string): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === method).map((call) => call[2])
}

async function renderCard(): Promise<HTMLElement> {
  render(<DotRemoteAccessCard />)
  await act(async () => {})
  return card()
}

function card(): HTMLElement {
  const shell = document.querySelector('[data-settings-section="integrations-dot-remote"]')
  if (!(shell instanceof HTMLElement)) {
    throw new Error('remote access card is missing')
  }
  return shell
}

const pill = (label: string): HTMLElement => within(card()).getByText(label, { selector: 'span' })
const remoteSwitch = (): HTMLElement =>
  within(card()).getByRole('switch', { name: 'Allow remote access' })
const originInput = (): HTMLInputElement => {
  const input = within(card()).getByLabelText('Site origin')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('origin field is missing')
  }
  return input
}
const tokenInput = (): HTMLInputElement => {
  const input = within(card()).getByLabelText('Site access token')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('token field is missing')
  }
  return input
}

async function saveConnection(origin: string, token: string): Promise<void> {
  fireEvent.change(originInput(), { target: { value: origin } })
  fireEvent.change(tokenInput(), { target: { value: token } })
  await act(async () => {
    fireEvent.click(within(card()).getByRole('button', { name: 'Save connection' }))
  })
}

describe('DotRemoteAccessCard: status, switch and connection', () => {
  beforeEach(() => {
    rpc.mockReset()
    toastSuccess.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('reads the remote status through the local desktop runtime only', async () => {
    answer({ 'workbench.dotRemote.status': fixtureRemoteStatus() })
    await renderCard()

    expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.dotRemote.status', undefined)
    expect(rpc.mock.calls.every((call) => JSON.stringify(call[0]) === '{"kind":"local"}')).toBe(
      true
    )
  })

  it('explains the mailbox, the outbound-only HTTPS polling and the read-only tasks', async () => {
    answer({ 'workbench.dotRemote.status': fixtureRemoteStatus() })
    const shell = await renderCard()

    const text = shell.textContent ?? ''
    expect(text).toMatch(/mailbox on your GPT Site/)
    expect(text).toMatch(/over HTTPS/)
    expect(text).toMatch(/opens no inbound port/)
    expect(text).toMatch(/read only/)
  })

  it('is off by default and says so', async () => {
    answer({ 'workbench.dotRemote.status': fixtureRemoteStatus() })
    const shell = await renderCard()

    expect(remoteSwitch().getAttribute('aria-checked')).toBe('false')
    expect(pill('Off')).toBeTruthy()
    expect(within(shell).getByRole('status').textContent).toMatch(/does not check the Site/)
  })

  it('switches remote access on and off and shows the status the app answers', async () => {
    answer({
      'workbench.dotRemote.status': fixtureRemoteStatus(),
      'workbench.dotRemote.enable': fixtureRemoteStatus({ state: 'unpaired', enabled: true }),
      'workbench.dotRemote.disable': fixtureRemoteStatus()
    })
    await renderCard()

    await act(async () => {
      fireEvent.click(remoteSwitch())
    })
    expect(callsTo('workbench.dotRemote.enable')).toEqual([undefined])
    expect(pill('Not paired')).toBeTruthy()
    expect(remoteSwitch().getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      fireEvent.click(remoteSwitch())
    })
    expect(callsTo('workbench.dotRemote.disable')).toEqual([undefined])
    expect(pill('Off')).toBeTruthy()
  })

  it('shows a connected mailbox with its last sync, without claiming dot is connected', async () => {
    answer({ 'workbench.dotRemote.status': fixtureConnectedRemoteStatus() })
    const shell = await renderCard()

    expect(pill('Connected')).toBeTruthy()
    expect(within(shell).getByRole('status').textContent).toMatch(
      /cannot tell whether dot is connected/
    )
    expect(shell.textContent).toMatch(/Last sync/)
    expect(shell.textContent).toMatch(/Paired/)
  })

  it('shows an offline mailbox in plain English', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConnectedRemoteStatus({ state: 'offline' })
    })
    const shell = await renderCard()

    expect(pill('Offline')).toBeTruthy()
    expect(within(shell).getByRole('status').textContent).toMatch(/keeps trying/)
  })

  it('warns with a label and an icon when sync keeps failing while the mailbox reads connected', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConnectedRemoteStatus({
        syncFailure: {
          consecutiveFailures: 4,
          lastCode: 'SQLITE_BUSY',
          since: '2026-10-05T09:30:00.000Z'
        }
      })
    })
    const shell = await renderCard()

    expect(pill('Sync failing')).toBeTruthy()
    const warning = within(shell).getByRole('alert', { name: 'Sync failing' })
    expect(warning.textContent).toMatch(/4 sync attempts in a row failed on this computer/)
    expect(warning.textContent).toContain('SQLITE_BUSY')
    expect(warning.querySelector('svg')).not.toBeNull()
  })

  it('shows no sync warning while syncs complete', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConnectedRemoteStatus({ syncFailure: null })
    })
    const shell = await renderCard()

    expect(pill('Connected')).toBeTruthy()
    expect(within(shell).queryByRole('alert')).toBeNull()
    expect(shell.textContent).not.toMatch(/Sync failing/)
  })

  it.each(DOT_REMOTE_RECONNECT_REASONS)(
    'explains a stop for %s and what resumes it',
    async (reason) => {
      answer({ 'workbench.dotRemote.status': fixtureReconnectRemoteStatus(reason) })
      const shell = await renderCard()

      const tokenStop = dotRemoteStateOfReason(reason) === 'reconnect_needed'
      expect(pill(tokenStop ? 'Reconnect needed' : 'Pair again')).toBeTruthy()
      expect(within(shell).getByRole('alert').textContent).toContain(
        dotRemoteReconnectMessage(reason)
      )
      expect(within(shell).queryAllByRole('button', { name: 'Pair again' })).toHaveLength(
        tokenStop ? 0 : 1
      )
    }
  )

  it('says when the local dot interface is closed and updates are waiting', async () => {
    answer({
      'workbench.dotRemote.status': fixtureConnectedRemoteStatus({
        localEndpoint: 'unavailable',
        pendingEvents: 3
      })
    })
    const shell = await renderCard()

    expect(shell.textContent).toMatch(/local dot interface is not listening/)
    expect(shell.textContent).toMatch(/Updates waiting to be sent: 3/)
  })

  it('refuses a non-https origin with its reason and sends nothing', async () => {
    answer({
      'workbench.dotRemote.status': fixtureRemoteStatus({ state: 'unpaired', enabled: true })
    })
    await renderCard()

    await saveConnection('http://fixture-nash.example.test', FIXTURE_REMOTE_TOKEN)

    expect(callsTo('workbench.dotRemote.setConnection')).toEqual([])
    expect(originInput().getAttribute('aria-invalid')).toBe('true')
    const alert = within(card()).getByRole('alert')
    expect(alert.textContent).toMatch(/must start with https/)
    expect(originInput().getAttribute('aria-describedby')).toContain(alert.id)
    expect(document.activeElement).toBe(originInput())

    fireEvent.change(originInput(), { target: { value: FIXTURE_REMOTE_ORIGIN } })
    expect(within(card()).queryByRole('alert')).toBeNull()
    expect(originInput().hasAttribute('aria-invalid')).toBe(false)
  })

  it('saves with Enter, confirms with a toast and never logs the token', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined)
    )
    answer({
      'workbench.dotRemote.status': fixtureConfiguredRemoteStatus(),
      'workbench.dotRemote.setConnection': fixtureConfiguredRemoteStatus()
    })
    await renderCard()

    fireEvent.change(tokenInput(), { target: { value: FIXTURE_REMOTE_TOKEN } })
    await act(async () => {
      fireEvent.submit(tokenInput().closest('form') ?? card())
    })

    expect(callsTo('workbench.dotRemote.setConnection')).toHaveLength(1)
    expect(toastSuccess).toHaveBeenCalledWith('Connection saved.')
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n')
    expect(logged).not.toContain(FIXTURE_REMOTE_TOKEN)
    consoleSpies.forEach((spy) => spy.mockRestore())
  })

  it('asks for the token when only the origin is filled in', async () => {
    answer({
      'workbench.dotRemote.status': fixtureRemoteStatus({ state: 'unpaired', enabled: true })
    })
    await renderCard()

    await saveConnection(FIXTURE_REMOTE_ORIGIN, '')

    expect(callsTo('workbench.dotRemote.setConnection')).toEqual([])
    expect(within(card()).getByRole('alert').textContent).toMatch(/Paste the Site access token/)
  })

  it('sends the token once, clears it at once and then shows only "Token saved"', async () => {
    let release: (value: unknown) => void = () => {}
    answer(
      { 'workbench.dotRemote.status': fixtureRemoteStatus({ state: 'unpaired', enabled: true }) },
      {
        'workbench.dotRemote.setConnection': () =>
          new Promise((resolve) => {
            release = resolve
          })
      }
    )
    await renderCard()

    await saveConnection(`${FIXTURE_REMOTE_ORIGIN}/`, FIXTURE_REMOTE_TOKEN)
    expect(tokenInput().value).toBe('')
    expect(tokenInput().type).toBe('password')
    await act(async () => {
      release(fixtureConfiguredRemoteStatus())
    })

    expect(callsTo('workbench.dotRemote.setConnection')).toEqual([
      { origin: FIXTURE_REMOTE_ORIGIN, serviceToken: FIXTURE_REMOTE_TOKEN }
    ])
    expect(within(card()).getByText('Token saved')).toBeTruthy()
    expect(document.body.innerHTML).not.toContain(FIXTURE_REMOTE_TOKEN)
    expect(originInput().value).toBe(FIXTURE_REMOTE_ORIGIN)
  })

  it('explains a refused token from its reason and never shows the server text', async () => {
    answer({
      'workbench.dotRemote.status': fixtureRemoteStatus({ state: 'unpaired', enabled: true }),
      'workbench.dotRemote.setConnection': refuse(DOT_REMOTE_RPC_ERROR_CODES.tokenInvalid, {
        reason: 'token_too_short'
      })
    })
    await renderCard()

    await saveConnection(FIXTURE_REMOTE_ORIGIN, 'FIXTURE_ONLY_x')

    expect(within(card()).getByRole('alert').textContent).toMatch(/too short/)
    expect(document.body.innerHTML).not.toContain('raw ')
    expect(document.body.innerHTML).not.toContain('FIXTURE_ONLY_x')
    expect(callsTo('workbench.dotRemote.status')).toHaveLength(2)
  })

  it('explains a token this computer cannot seal', async () => {
    answer({
      'workbench.dotRemote.status': fixtureRemoteStatus({ serviceToken: 'sealing_unavailable' })
    })
    const shell = await renderCard()

    expect(shell.textContent).toMatch(/cannot seal/)
    expect(within(shell).queryByText('Token saved')).toBeNull()
  })

  it('keeps a refused switch change visible in plain English', async () => {
    answer({
      'workbench.dotRemote.status': fixtureRemoteStatus(),
      'workbench.dotRemote.enable': refuse(DOT_REMOTE_RPC_ERROR_CODES.unavailable)
    })
    await renderCard()

    await act(async () => {
      fireEvent.click(remoteSwitch())
    })

    expect(within(card()).getByRole('alert').textContent).toMatch(/not running/)
    expect(document.body.innerHTML).not.toContain('raw ')
  })

  it('reports an unregistered method as not connected and offers no controls', async () => {
    answer({ 'workbench.dotRemote.status': refuse('method_not_found') })
    const shell = await renderCard()

    expect(within(shell).getByRole('alert').textContent).toMatch(/not connected in this build/)
    expect(within(shell).queryAllByRole('switch')).toHaveLength(0)
    expect(within(shell).queryByLabelText('Site access token')).toBeNull()
    expect(screen.getByText('Unavailable', { selector: 'span' })).toBeTruthy()
  })
})

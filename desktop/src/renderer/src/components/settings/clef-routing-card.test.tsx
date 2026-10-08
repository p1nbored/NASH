// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchRoutingStatusView } from '../../../../shared/clef/workbench-routing-status-view'
import { ClefRoutingCard } from './clef-routing-card'
import { fixtureStatus } from './clef-verification.test-fixture'
import type { ClefVerificationModel } from './use-clef-verification'

// FIXTURE_ONLY: fake values shaped like real Clef credentials; never real secrets.
const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'

const ABSENT = { tokenPresent: false, accountPresent: false, protection: 'absent' }
const SEALED = { tokenPresent: true, accountPresent: true, protection: 'sealed' }
const UNAVAILABLE = {
  tokenPresent: false,
  accountPresent: false,
  protection: 'sealing_unavailable'
}

const api = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn(), clear: vi.fn() }))
const verification = vi.hoisted(() => {
  const state: { status: WorkbenchRoutingStatusView | null } = { status: null }
  return { ...state, refresh: vi.fn(async () => {}) }
})

// Why mocked: the verification RPC has its own tests (clef-verification-section.test.tsx).
vi.mock('./use-clef-verification', () => ({
  useClefVerification: (): ClefVerificationModel => ({
    status: verification.status,
    statusError: null,
    loading: false,
    running: null,
    result: null,
    pinned: null,
    error: null,
    verify: vi.fn(async () => {}),
    pin: vi.fn(async () => {}),
    refresh: verification.refresh
  })
}))
vi.mock('./clef-verification-section', () => ({
  ClefVerificationSection: () => <section aria-label="Verification section" />
}))

async function renderCard(initial: unknown = ABSENT): Promise<HTMLElement> {
  api.status.mockResolvedValue(initial)
  const view = render(<ClefRoutingCard />)
  await act(async () => {})
  return view.container
}

function tokenInput(): HTMLInputElement {
  const input = screen.getByLabelText('API token')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('API token field is not an input')
  }
  return input
}

function accountInput(): HTMLInputElement {
  const input = screen.getByLabelText('Account ID')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Account ID field is not an input')
  }
  return input
}

async function submitCredentials(): Promise<void> {
  fireEvent.change(tokenInput(), { target: { value: FIXTURE_ONLY_TOKEN } })
  fireEvent.change(accountInput(), { target: { value: FIXTURE_ONLY_ACCOUNT_ID } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }))
  })
}

function statusLabel(text: string): HTMLElement {
  const label = screen.getByText(text, { selector: 'span' }).closest('[data-status-tone]')
  if (!(label instanceof HTMLElement)) {
    throw new Error(`no status label ${text}`)
  }
  return label
}

describe('ClefRoutingCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verification.status = null
    Object.assign(window, { api: { clefCredentials: api } })
  })

  afterEach(() => {
    cleanup()
  })

  it('reports missing credentials in one line without claiming a connection', async () => {
    const container = await renderCard(ABSENT)

    expect(statusLabel('Not set up').querySelector('svg')).not.toBeNull()
    expect(container.textContent).not.toMatch(/connected/i)
    expect(tokenInput()).toBeTruthy()
  })

  it('shows each credential problem with a label and an icon, never colour alone', async () => {
    await renderCard({ ...SEALED, protection: 'plaintext_refused' })
    expect(statusLabel('Not protected').getAttribute('data-status-tone')).toBe('warning')
    const problem = screen.getByText(/not protected, so NASH does not use them/)
    expect(problem.closest('[data-status-tone]')?.querySelector('svg')).not.toBeNull()
    cleanup()

    await renderCard(UNAVAILABLE)
    expect(statusLabel('Cannot store credentials').getAttribute('data-status-tone')).toBe('error')
    expect(screen.getByText(/cannot store credentials safely/)).toBeTruthy()
    cleanup()

    await renderCard({ ...SEALED, accountPresent: false })
    expect(statusLabel('Incomplete')).toBeTruthy()
    expect(screen.getByText('API token saved; account ID missing')).toBeTruthy()
  })

  it('shows saved credentials as one row, and the Clef status once it is read', async () => {
    verification.status = fixtureStatus({ status: 'ready' })
    await renderCard(SEALED)

    expect(statusLabel('Ready').getAttribute('data-status-tone')).toBe('success')
    expect(screen.getByText(/Saved on this computer/)).toBeTruthy()
    expect(screen.queryByLabelText('API token')).toBeNull()
    cleanup()

    verification.status = null
    await renderCard(SEALED)
    expect(statusLabel('Credentials saved')).toBeTruthy()
  })

  it('says the status could not be read instead of showing nothing stored', async () => {
    api.status.mockRejectedValue(new Error('ipc failed'))
    render(<ClefRoutingCard />)
    await act(async () => {})

    expect(statusLabel('Status unavailable')).toBeTruthy()
    expect(screen.getByText(/Could not read whether Clef credentials are stored/)).toBeTruthy()
  })

  it('masks both fields by default with autocomplete and spellcheck off', async () => {
    await renderCard()

    for (const input of [tokenInput(), accountInput()]) {
      expect(input.type).toBe('password')
      expect(input.getAttribute('autocomplete')).toBe('off')
      expect(input.getAttribute('spellcheck')).toBe('false')
    }
    const toggle = screen.getByRole('button', { name: 'Show API token' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(tokenInput().type).toBe('text')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(accountInput().type).toBe('password')
  })

  it('sends the values once, then never renders the token and reads the Clef status again', async () => {
    api.save.mockResolvedValue({ ok: true, status: SEALED })
    const container = await renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Show API token' }))

    await submitCredentials()

    expect(api.save).toHaveBeenCalledTimes(1)
    expect(api.save).toHaveBeenCalledWith({
      token: FIXTURE_ONLY_TOKEN,
      accountId: FIXTURE_ONLY_ACCOUNT_ID
    })
    expect(container.innerHTML).not.toContain(FIXTURE_ONLY_TOKEN)
    expect(document.body.innerHTML).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
    expect(screen.getByRole('status').textContent).toMatch(/never be shown again/)
    expect(statusLabel('Credentials saved')).toBeTruthy()
    expect(verification.refresh).toHaveBeenCalledTimes(1)
  })

  it('replaces saved credentials through the same form, or keeps them on Cancel', async () => {
    await renderCard(SEALED)

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(tokenInput().value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('API token')).toBeNull()
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy()
  })

  it('explains a refusal in plain English and still empties the inputs', async () => {
    api.save.mockResolvedValue({ ok: false, code: 'sealing_unavailable', status: UNAVAILABLE })
    await renderCard(UNAVAILABLE)

    await submitCredentials()

    expect(screen.getByRole('alert').textContent).toBe(
      'This computer cannot store the token safely, so it was not saved.'
    )
    expect(tokenInput().value).toBe('')
    expect(accountInput().value).toBe('')
    expect(document.body.innerHTML).not.toContain(FIXTURE_ONLY_TOKEN)
  })

  it('reports a failed save call without echoing anything that was typed', async () => {
    api.save.mockRejectedValue(new Error(`boom ${FIXTURE_ONLY_TOKEN}`))
    await renderCard()

    await submitCredentials()

    expect(screen.getByRole('alert').textContent).toMatch(/could not be saved/i)
    expect(document.body.innerHTML).not.toContain(FIXTURE_ONLY_TOKEN)
    expect(tokenInput().value).toBe('')
  })

  it('asks for both values before sending anything', async () => {
    await renderCard()
    fireEvent.change(tokenInput(), { target: { value: FIXTURE_ONLY_TOKEN } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }))
    })

    expect(api.save).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(
      'Enter both the API token and the account ID.'
    )
    expect(accountInput().getAttribute('aria-invalid')).toBe('true')
  })

  it('clears stored credentials only after an in-page confirmation', async () => {
    const confirmSpy = vi.fn(() => true)
    Object.assign(window, { confirm: confirmSpy })
    api.clear.mockResolvedValue({ ok: true, status: ABSENT })
    await renderCard(SEALED)

    fireEvent.click(screen.getByRole('button', { name: 'Clear credentials' }))
    const dialog = await screen.findByRole('dialog', { name: 'Clear Clef credentials?' })
    expect(api.clear).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.clear).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Clear credentials' }))
    const again = await screen.findByRole('dialog', { name: 'Clear Clef credentials?' })
    await act(async () => {
      fireEvent.click(within(again).getByRole('button', { name: 'Clear credentials' }))
    })

    expect(api.clear).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(statusLabel('Not set up')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear credentials' })).toBeNull()
    expect(verification.refresh).toHaveBeenCalledTimes(1)
  })

  it('offers no clear action when nothing is stored', async () => {
    await renderCard(ABSENT)
    expect(screen.queryByRole('button', { name: 'Clear credentials' })).toBeNull()
  })

  it('keeps storage notes and versions out of the text', async () => {
    verification.status = fixtureStatus()
    const container = await renderCard(SEALED)

    expect(container.textContent).toMatch(/sorts each task/)
    expect(container.textContent).not.toMatch(/sealed|keyring|Keychain|data protection|rotate/i)
    expect(container.textContent).not.toMatch(/Question set|taxonomy|bundle/i)
    const section = screen.getByRole('region', { name: 'Verification section' })
    const replace = screen.getByRole('button', { name: 'Replace' })
    // Why document order: verification follows the credentials.
    expect(replace.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('builds every control from the shared primitives that draw a solid focus indicator', async () => {
    verification.status = fixtureStatus()
    const container = await renderCard(ABSENT)

    const controls = container.querySelectorAll('button, input')
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      expect(control.getAttribute('data-slot'), control.outerHTML).toMatch(
        /^(button|input|collapsible-trigger)$/
      )
      expect(control.className).toMatch(/focus-visible:border-ring/)
    }
  })
})

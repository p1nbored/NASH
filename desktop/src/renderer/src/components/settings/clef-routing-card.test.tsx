// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClefRoutingCard } from './clef-routing-card'

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

// Why mocked: the section reads the runtime RPC; clef-verification-section.test.tsx covers it.
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

describe('ClefRoutingCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, { api: { clefCredentials: api } })
  })

  afterEach(() => {
    cleanup()
  })

  it('reports missing credentials without claiming a connection', async () => {
    await renderCard(ABSENT)

    expect(screen.getByText('Not configured')).toBeTruthy()
    const status = screen.getByRole('list', { name: 'Credential status' })
    expect(within(status).getByText('No API token or account ID saved')).toBeTruthy()
    expect(within(status).getByText('Nothing stored')).toBeTruthy()
    expect(status.textContent).not.toMatch(/connected/i)
    expect(screen.queryByText(/^connected$/i)).toBeNull()
  })

  it('labels each protection state with text and an icon, never colour alone', async () => {
    await renderCard(SEALED)
    const status = screen.getByRole('list', { name: 'Credential status' })
    const sealed = within(status).getByText('Sealed with the OS credential store')
    expect(sealed.closest('li')?.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('Credentials saved')).toBeTruthy()
    cleanup()

    await renderCard({ ...SEALED, protection: 'plaintext_refused' })
    expect(screen.getByText('Not sealed')).toBeTruthy()
    const refused = screen.getByRole('list', { name: 'Credential status' })
    expect(
      within(refused)
        .getByText(/^Not sealed:/)
        .closest('li')
        ?.querySelector('svg')
    ).not.toBeNull()
    cleanup()

    await renderCard(UNAVAILABLE)
    expect(screen.getByText('Sealing unavailable')).toBeTruthy()
    const unavailable = screen.getByRole('list', { name: 'Credential status' })
    expect(within(unavailable).getByText(/^Sealing unavailable on this system/)).toBeTruthy()
  })

  it('says the status could not be read instead of showing "nothing stored"', async () => {
    api.status.mockRejectedValue(new Error('ipc failed'))
    render(<ClefRoutingCard />)
    await act(async () => {})

    expect(screen.getByText('Status unavailable')).toBeTruthy()
    expect(screen.queryByText('Nothing stored')).toBeNull()
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

  it('sends the values once, then empties the inputs and never renders the token', async () => {
    api.save.mockResolvedValue({ ok: true, status: SEALED })
    const container = await renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Show API token' }))

    await submitCredentials()

    expect(api.save).toHaveBeenCalledTimes(1)
    expect(api.save).toHaveBeenCalledWith({
      token: FIXTURE_ONLY_TOKEN,
      accountId: FIXTURE_ONLY_ACCOUNT_ID
    })
    expect(tokenInput().value).toBe('')
    expect(accountInput().value).toBe('')
    expect(tokenInput().type).toBe('password')
    expect(container.innerHTML).not.toContain(FIXTURE_ONLY_TOKEN)
    expect(document.body.innerHTML).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
    expect(screen.getByRole('status').textContent).toMatch(/never be shown again/)
    expect(screen.getByText('Credentials saved')).toBeTruthy()
  })

  it('explains a refusal in plain English and still empties the inputs', async () => {
    api.save.mockResolvedValue({ ok: false, code: 'sealing_unavailable', status: UNAVAILABLE })
    await renderCard(UNAVAILABLE)

    await submitCredentials()

    expect(screen.getByRole('alert').textContent).toBe(
      'Sealing is unavailable on this system, so the token was not saved.'
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
    expect(screen.getByText('Not configured')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear credentials' })).toBeNull()
  })

  it('offers no clear action when nothing is stored', async () => {
    await renderCard(ABSENT)
    expect(screen.queryByRole('button', { name: 'Clear credentials' })).toBeNull()
  })

  it('mounts the verification section under the credentials', async () => {
    const container = await renderCard(SEALED)

    const section = screen.getByRole('region', { name: 'Verification section' })
    const form = screen.getByRole('button', { name: 'Save credentials' })
    // Why document order: the section follows the credential form inside the card.
    expect(form.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.textContent).toMatch(/classifies/)
  })

  it('builds every control from the shared primitives that draw a solid focus indicator', async () => {
    const container = await renderCard(SEALED)

    const controls = container.querySelectorAll('button, input')
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      expect(control.getAttribute('data-slot'), control.outerHTML).toMatch(/^(button|input)$/)
      expect(control.className).toMatch(/focus-visible:border-ring/)
    }
  })
})

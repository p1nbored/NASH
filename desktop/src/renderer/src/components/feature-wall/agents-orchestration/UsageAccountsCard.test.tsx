// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const rateLimits: Record<string, unknown> = { claude: null, codex: null }
  return { codexList: vi.fn(), rateLimits }
})

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      fetchSettings: async () => {},
      fetchRateLimits: async () => {},
      rateLimits: mocks.rateLimits
    })
}))

import { UsageAccountsCard } from './UsageAccountsCard'

const EMPTY_ACCOUNTS = { accounts: [], activeAccountId: null }
const UNKNOWN_TEXT = 'Account status unknown'
const NOT_SET_UP_TEXT = 'Tracking not set up'

let container: HTMLDivElement
let root: Root

async function renderCard(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<UsageAccountsCard />)
  })
}

describe('UsageAccountsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rateLimits = { claude: null, codex: null }
    // Why no claudeAccounts: Claude account switching is removed, so any Claude account call throws.
    Object.assign(window, {
      api: {
        codexAccounts: { list: mocks.codexList, add: vi.fn() }
      }
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('offers no Claude sign-in row and keeps the Codex row', async () => {
    mocks.codexList.mockResolvedValue(EMPTY_ACCOUNTS)

    await renderCard()

    const headings = Array.from(container.querySelectorAll('h3')).map((node) => node.textContent)
    expect(headings).toEqual(['Codex'])
  })

  it('stops asserting "Tracking not set up" while the Codex list never loaded', async () => {
    mocks.codexList.mockRejectedValue(new Error('offline'))

    await renderCard()

    expect(container.textContent).toContain(UNKNOWN_TEXT)
    expect(container.textContent).not.toContain(NOT_SET_UP_TEXT)
  })

  it('keeps the real label when the list resolves empty', async () => {
    mocks.codexList.mockResolvedValue(EMPTY_ACCOUNTS)

    await renderCard()

    expect(container.textContent).not.toContain(UNKNOWN_TEXT)
    expect(container.textContent).toContain(NOT_SET_UP_TEXT)
  })

  it('prefers the observed connection when rate limits already prove tracking is on', async () => {
    mocks.codexList.mockRejectedValue(new Error('offline'))
    mocks.rateLimits = { claude: null, codex: { status: 'ok', session: null, weekly: null } }

    await renderCard()

    expect(container.textContent).not.toContain(UNKNOWN_TEXT)
    expect(container.textContent).toContain('Connected · System default')
  })

  it('does not claim tracking is unset while the account read is pending', async () => {
    let rejectCodex: (reason: Error) => void = () => {}
    mocks.codexList.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCodex = reject
      })
    )

    await renderCard()

    expect(container.textContent).toContain(UNKNOWN_TEXT)
    expect(container.textContent).not.toContain(NOT_SET_UP_TEXT)

    await act(async () => {
      rejectCodex(new Error('offline'))
      await Promise.resolve()
    })

    expect(container.textContent).toContain(UNKNOWN_TEXT)
  })
})

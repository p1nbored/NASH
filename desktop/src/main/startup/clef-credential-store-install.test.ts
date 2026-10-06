import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createStore } = vi.hoisted(() => ({
  createStore: vi.fn(() => ({
    status: vi.fn(() => ({ tokenPresent: false, accountPresent: false, protection: 'absent' })),
    read: vi.fn(() => null),
    generation: vi.fn(),
    save: vi.fn(),
    clear: vi.fn()
  }))
}))

vi.mock('../clef/clef-sealed-credential-store', () => ({
  createClefSealedCredentialStore: createStore
}))

describe('installClefCredentialStore', () => {
  beforeEach(() => {
    vi.resetModules()
    createStore.mockClear()
  })

  it('creates exactly one sealed store however often startup asks for it', async () => {
    const { installClefCredentialStore } = await import('./clef-credential-store-install')

    const first = installClefCredentialStore()
    const second = installClefCredentialStore()

    expect(createStore).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('installs that same instance as the credential source the router reads', async () => {
    const { installClefCredentialStore } = await import('./clef-credential-store-install')
    const { getClefCredentialSource } = await import('../clef/clef-credential-port')

    expect(getClefCredentialSource().status().protection).toBe('absent')
    const store = installClefCredentialStore()

    expect(getClefCredentialSource()).toBe(store)
  })
})

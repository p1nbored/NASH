import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClefCredentialGeneration } from '../clef/clef-credential-generation'
import type { ClefCredentialStatus } from '../clef/clef-credential-port'
import type { ClefSealedCredentialStore } from '../clef/clef-sealed-credential-store'

const { handlers, fromIdMock } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  fromIdMock: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: fromIdMock },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

import { CLEF_CREDENTIAL_CHANNELS, registerClefCredentialsHandlers } from './clef-credentials'
import { setTrustedUIRendererWebContentsId } from './ui'

// FIXTURE_ONLY: fake values shaped like real Clef credentials; never real secrets.
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'

const SEALED: ClefCredentialStatus = {
  tokenPresent: true,
  accountPresent: true,
  protection: 'sealed'
}
const ABSENT: ClefCredentialStatus = {
  tokenPresent: false,
  accountPresent: false,
  protection: 'absent'
}

function sender(id = 7) {
  return { id, mainFrame: {}, isDestroyed: vi.fn(() => false) }
}

function trustedEvent() {
  const primary = sender()
  setTrustedUIRendererWebContentsId(primary.id)
  fromIdMock.mockImplementation((id) => (id === primary.id ? primary : null))
  return { sender: primary, senderFrame: primary.mainFrame }
}

function fakeStore() {
  const generation = ClefCredentialGeneration.mint()
  return {
    status: vi.fn((): ClefCredentialStatus => ABSENT),
    read: vi.fn(() => null),
    generation: vi.fn(() => generation),
    save: vi.fn<ClefSealedCredentialStore['save']>(() => ({ ok: true })),
    clear: vi.fn<ClefSealedCredentialStore['clear']>(() => ({ ok: true }))
  }
}

async function invoke(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return await handler(event, ...args)
}

describe('registerClefCredentialsHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    fromIdMock.mockReset()
    fromIdMock.mockReturnValue(null)
    setTrustedUIRendererWebContentsId(null)
  })

  it('registers the status, save and clear channels', () => {
    registerClefCredentialsHandlers(fakeStore())
    expect(CLEF_CREDENTIAL_CHANNELS).toEqual({
      status: 'clef:credentials:status',
      save: 'clef:credentials:save',
      clear: 'clef:credentials:clear'
    })
    expect([...handlers.keys()].sort()).toEqual([
      'clef:credentials:clear',
      'clef:credentials:save',
      'clef:credentials:status'
    ])
  })

  it('returns presence and protection only, never a value', async () => {
    const store = fakeStore()
    store.status.mockReturnValue(SEALED)
    registerClefCredentialsHandlers(store)
    const status = await invoke(CLEF_CREDENTIAL_CHANNELS.status, trustedEvent())
    expect(status).toEqual(SEALED)
    expect(store.read).not.toHaveBeenCalled()
  })

  it('saves the token and account id together and reports the new status', async () => {
    const store = fakeStore()
    const onCredentialsChanged = vi.fn()
    store.status.mockReturnValue(SEALED)
    registerClefCredentialsHandlers(store, { onCredentialsChanged })
    const result = await invoke(CLEF_CREDENTIAL_CHANNELS.save, trustedEvent(), {
      token: FIXTURE_ONLY_TOKEN,
      accountId: FIXTURE_ONLY_ACCOUNT_ID
    })
    expect(store.save).toHaveBeenCalledExactlyOnceWith(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)
    expect(result).toEqual({ ok: true, status: SEALED })
    expect(JSON.stringify(result)).not.toContain(FIXTURE_ONLY_TOKEN)
    expect(JSON.stringify(result)).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
    expect(onCredentialsChanged).toHaveBeenCalledTimes(1)
  })

  it('returns only the refusal code when the store rejects the values', async () => {
    const store = fakeStore()
    const onCredentialsChanged = vi.fn()
    store.save.mockReturnValue({ ok: false, code: 'account_id_invalid_format' })
    registerClefCredentialsHandlers(store, { onCredentialsChanged })
    const result = await invoke(CLEF_CREDENTIAL_CHANNELS.save, trustedEvent(), {
      token: FIXTURE_ONLY_TOKEN,
      accountId: 'NOT-HEX'
    })
    expect(result).toEqual({ ok: false, code: 'account_id_invalid_format', status: ABSENT })
    expect(JSON.stringify(result)).not.toContain('NOT-HEX')
    expect(onCredentialsChanged).not.toHaveBeenCalled()
  })

  it('treats a malformed payload as missing values instead of trusting its type', async () => {
    const store = fakeStore()
    store.save.mockReturnValue({ ok: false, code: 'token_missing' })
    registerClefCredentialsHandlers(store)
    for (const payload of [undefined, null, 'token', { token: 42, accountId: ['x'] }]) {
      await invoke(CLEF_CREDENTIAL_CHANNELS.save, trustedEvent(), payload)
    }
    for (const call of store.save.mock.calls) {
      expect(call).toEqual(['', ''])
    }
    expect(store.save).toHaveBeenCalledTimes(4)
  })

  it('clears both values, notifies and reports the cleared status', async () => {
    const store = fakeStore()
    const onCredentialsChanged = vi.fn()
    registerClefCredentialsHandlers(store, { onCredentialsChanged })
    const result = await invoke(CLEF_CREDENTIAL_CHANNELS.clear, trustedEvent())
    expect(store.clear).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, status: ABSENT })
    expect(onCredentialsChanged).toHaveBeenCalledTimes(1)
  })

  it('reports a failed clear by code and still notifies', async () => {
    const store = fakeStore()
    const onCredentialsChanged = vi.fn()
    store.clear.mockReturnValue({ ok: false, code: 'clear_failed' })
    registerClefCredentialsHandlers(store, { onCredentialsChanged })
    const result = await invoke(CLEF_CREDENTIAL_CHANNELS.clear, trustedEvent())
    expect(result).toEqual({ ok: false, code: 'clear_failed', status: ABSENT })
    expect(onCredentialsChanged).toHaveBeenCalledTimes(1)
  })

  it('logs and swallows a failing change listener so the save still reports', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = fakeStore()
    registerClefCredentialsHandlers(store, {
      onCredentialsChanged: () => {
        throw new Error('listener boom')
      }
    })
    const result = await invoke(CLEF_CREDENTIAL_CHANNELS.save, trustedEvent(), {
      token: FIXTURE_ONLY_TOKEN,
      accountId: FIXTURE_ONLY_ACCOUNT_ID
    })
    expect(result).toMatchObject({ ok: true })
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[clef]'), expect.any(Error))
    errorSpy.mockRestore()
  })

  describe('caller admission', () => {
    const channels = Object.values(CLEF_CREDENTIAL_CHANNELS)

    async function expectRejectedEverywhere(event: unknown, message: string): Promise<void> {
      const store = fakeStore()
      registerClefCredentialsHandlers(store)
      for (const channel of channels) {
        await expect(
          invoke(channel, event, { token: FIXTURE_ONLY_TOKEN, accountId: FIXTURE_ONLY_ACCOUNT_ID })
        ).rejects.toThrow(message)
      }
      expect(store.status).not.toHaveBeenCalled()
      expect(store.save).not.toHaveBeenCalled()
      expect(store.clear).not.toHaveBeenCalled()
    }

    it('rejects calls from a child or replaced frame', async () => {
      const event = trustedEvent()
      await expectRejectedEverywhere({ ...event, senderFrame: {} }, 'current main frame')
    })

    it('rejects another webContents that claims the trusted id', async () => {
      const event = trustedEvent()
      const impostor = sender(event.sender.id)
      await expectRejectedEverywhere(
        { sender: impostor, senderFrame: impostor.mainFrame },
        'trusted application renderer'
      )
    })

    it('rejects every caller while no trusted renderer is registered', async () => {
      const primary = sender()
      fromIdMock.mockReturnValue(primary)
      await expectRejectedEverywhere(
        { sender: primary, senderFrame: primary.mainFrame },
        'trusted application renderer'
      )
    })

    it('rejects a destroyed trusted renderer', async () => {
      const event = trustedEvent()
      event.sender.isDestroyed.mockReturnValue(true)
      await expectRejectedEverywhere(event, 'trusted application renderer')
    })
  })
})

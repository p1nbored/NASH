import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { credential } from './native-account-test-fixtures'
import {
  readAntigravityWindowsCredential,
  writeAntigravityWindowsCredential,
  type WindowsGenericCredentialApi,
  type WindowsGenericCredentialReadResult,
  type WindowsGenericCredentialWriteResult
} from './native-windows-credentials'

type Item = { blob: Uint8Array; userName: string | null; persist: number }

function fakeStore(initial: Record<string, Item> = {}) {
  const items = new Map(Object.entries(initial))
  const api = {
    readGenericCredential: vi.fn((target: string): WindowsGenericCredentialReadResult => {
      const item = items.get(target)
      return item
        ? { status: 'found', ...item, blob: Buffer.from(item.blob) }
        : { status: 'missing' }
    }),
    writeGenericCredential: vi.fn(
      (
        target: string,
        userName: string | null,
        blob: Uint8Array,
        persist: number
      ): WindowsGenericCredentialWriteResult => {
        items.set(target, { blob: Buffer.from(blob), userName, persist })
        return { status: 'ok' }
      }
    )
  } satisfies WindowsGenericCredentialApi
  return { api, items }
}

const AGY = 'gemini:antigravity'
const a = credential('a')
const b = credential('b', 2)
const agyItem = (contents: string, overrides: Partial<Item> = {}): Record<string, Item> => ({
  [AGY]: { blob: Buffer.from(contents, 'utf8'), userName: 'antigravity', persist: 2, ...overrides }
})

beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
})

afterEach(() => vi.restoreAllMocks())

describe('Antigravity Windows Credential Manager access', () => {
  it('reads only the native agy item as raw UTF-8 JSON', async () => {
    const { api } = fakeStore(agyItem(a))
    const current = await readAntigravityWindowsCredential({ api })
    expect(current?.contents).toBe(a)
    expect(current?.identity?.subject).toBe('a')
    expect(api.readGenericCredential.mock.calls).toEqual([[AGY]])
    expect(api.writeGenericCredential).not.toHaveBeenCalled()
  })

  it('treats a missing item as signed out but a denied read as a failure', async () => {
    expect(await readAntigravityWindowsCredential({ api: fakeStore().api })).toBeNull()
    const denied = fakeStore().api
    denied.readGenericCredential.mockReturnValue({ status: 'error', code: 5 })
    await expect(readAntigravityWindowsCredential({ api: denied })).rejects.toThrow(
      'The Antigravity Windows credential store could not be read (Windows error 5).'
    )
  })

  it('rejects malformed native answers instead of guessing', async () => {
    for (const answer of [
      { status: 'found', blob: Buffer.alloc(2561, 0x20), userName: 'antigravity', persist: 2 },
      { status: 'found', blob: Buffer.from(a), userName: 'antigravity', persist: 9 },
      { status: 'found', blob: 'not bytes', userName: 'antigravity', persist: 2 },
      { status: 'error', code: 'secret-shaped' },
      { status: 'unknown' }
    ]) {
      const { api } = fakeStore()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: deliberately malformed native output under test.
      api.readGenericCredential.mockReturnValue(answer as WindowsGenericCredentialReadResult)
      await expect(readAntigravityWindowsCredential({ api })).rejects.toThrow(
        /^The Antigravity Windows credential store could not be read\.$/
      )
    }
  })

  it('never exposes native exception text or credential bytes in errors', async () => {
    const throwing = fakeStore().api
    throwing.readGenericCredential.mockImplementation(() => {
      throw new Error('synthetic-secret native detail')
    })
    await expect(readAntigravityWindowsCredential({ api: throwing })).rejects.toThrow(
      /^The Antigravity Windows credential store could not be accessed\.$/
    )
    const leaky = JSON.stringify({ auth_method: 'consumer', token: 'synthetic-secret' })
    for (const blob of [Buffer.from(leaky), Buffer.from([0xff, 0xfe, 0x73])]) {
      const { api } = fakeStore({ [AGY]: { blob, userName: 'antigravity', persist: 2 } })
      const failure = await readAntigravityWindowsCredential({ api }).catch((error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(String(failure.message)).not.toContain('synthetic-secret')
      expect(failure.message).toBe('Antigravity credentials could not be decoded.')
    }
  })

  it('preserves the native user name and persistence when replacing the item', async () => {
    const { api, items } = fakeStore(agyItem(a, { userName: 'kept-user', persist: 3 }))
    await writeAntigravityWindowsCredential(b, a, { api })
    expect(api.writeGenericCredential).toHaveBeenCalledOnce()
    expect(api.writeGenericCredential).toHaveBeenCalledWith(AGY, 'kept-user', Buffer.from(b), 3)
    expect(Buffer.from(items.get(AGY)?.blob ?? []).toString('utf8')).toBe(b)
  })

  it('creates the item as agy does when no account is signed in', async () => {
    const { api } = fakeStore()
    await writeAntigravityWindowsCredential(a, null, { api })
    expect(api.writeGenericCredential).toHaveBeenCalledWith(AGY, 'antigravity', Buffer.from(a), 2)
  })

  it('refuses a stale expected value before writing', async () => {
    const { api } = fakeStore(agyItem(b))
    await expect(writeAntigravityWindowsCredential(a, a, { api })).rejects.toThrow(
      'changed during selection'
    )
    await expect(writeAntigravityWindowsCredential(a, null, { api })).rejects.toThrow(
      'changed during selection'
    )
    expect(api.writeGenericCredential).not.toHaveBeenCalled()
  })

  it('refuses credentials over 2,560 bytes before touching the active login', async () => {
    const { api } = fakeStore(agyItem(a))
    const large = credential('a').replace('synthetic-1', 'x'.repeat(2560))
    await expect(writeAntigravityWindowsCredential(large, a, { api })).rejects.toThrow(
      'exceed the Windows Credential Manager limit'
    )
    expect(api.readGenericCredential).not.toHaveBeenCalled()
    expect(api.writeGenericCredential).not.toHaveBeenCalled()
  })

  it('does not claim a successful switch when the read-back differs', async () => {
    const { api, items } = fakeStore(agyItem(a))
    api.writeGenericCredential.mockImplementation((target, userName, _blob, persist) => {
      items.set(target, { blob: Buffer.from(credential('other')), userName, persist })
      return { status: 'ok' }
    })
    await expect(writeAntigravityWindowsCredential(b, a, { api })).rejects.toThrow(
      'The Antigravity Windows credential update could not be verified.'
    )
  })

  it('reports a refused write by its Windows error code only', async () => {
    const { api } = fakeStore(agyItem(a))
    api.writeGenericCredential.mockReturnValue({ status: 'error', code: 1312 })
    await expect(writeAntigravityWindowsCredential(b, a, { api })).rejects.toThrow(
      /^The Antigravity Windows credential store could not be updated \(Windows error 1312\)\.$/
    )
  })

  it('writes and reads a disposable target when one is given', async () => {
    const { api, items } = fakeStore()
    const target = { target: 'nash-test:unit', userName: 'task-only' }
    await writeAntigravityWindowsCredential(a, null, { api, target })
    expect((await readAntigravityWindowsCredential({ api, target }))?.contents).toBe(a)
    expect([...items.keys()]).toEqual(['nash-test:unit'])
  })

  it.each(['darwin', 'linux'] as const)(
    'does not answer for a different host (%s)',
    async (platform) => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
      const { api } = fakeStore(agyItem(a))
      await expect(readAntigravityWindowsCredential({ api })).rejects.toThrow(
        'unavailable on this host'
      )
      await expect(writeAntigravityWindowsCredential(b, a, { api })).rejects.toThrow(
        'unavailable on this host'
      )
      expect(api.readGenericCredential).not.toHaveBeenCalled()
      expect(api.writeGenericCredential).not.toHaveBeenCalled()
    }
  )
})

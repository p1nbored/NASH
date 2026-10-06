import type * as FsModule from 'node:fs'
import type * as OsModule from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtureFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writes: [] as { path: string; contents: string }[]
}))

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  // Why: a reversible XOR stands in for the OS keyring so sealed bytes never equal the input.
  encryptString: vi.fn((value: string) =>
    Buffer.from(Array.from(Buffer.from(value, 'utf8'), (byte) => byte ^ 0x5a))
  ),
  decryptString: vi.fn((payload: Buffer) =>
    Buffer.from(Array.from(payload, (byte) => byte ^ 0x5a)).toString('utf8')
  )
}))

vi.mock('electron', () => ({ safeStorage: safeStorageMock }))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof OsModule>()),
  homedir: () => 'fixture-home'
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof FsModule>()),
  existsSync: (path: string) => fixtureFs.files.has(String(path)),
  readFileSync: (path: string) => {
    const contents = fixtureFs.files.get(String(path))
    if (contents === undefined) {
      throw Object.assign(new Error('fixture ENOENT'), { code: 'ENOENT' })
    }
    return Buffer.from(contents, 'utf8')
  },
  rmSync: (path: string) => {
    fixtureFs.files.delete(String(path))
  }
}))

vi.mock('../../shared/secure-file', () => ({
  hardenExistingSecureFile: () => undefined,
  isUnreadableError: () => false,
  writeSecureFile: (path: string, contents: string) => {
    fixtureFs.writes.push({ path, contents })
    fixtureFs.files.set(path, contents)
    return true
  }
}))

import { ApiKeySealingUnavailableError } from './api-key-sealing-unavailable-error'
import { createEncryptedApiKeyFileStore } from './encrypted-api-key-file-store'

// FIXTURE_ONLY: an obviously fake key; never a real secret.
const FIXTURE_ONLY_KEY = 'FAKE_API_KEY_FIXTURE_ONLY_0000000000'
const KEY_PATH = join('fixture-home', '.nash', 'fixture-api-key.enc')
const PREFIX = 'orca-fixture-api-key:v1:'

function plaintextEnvelope(value: string): string {
  return `${PREFIX}plaintext:${Buffer.from(value, 'utf8').toString('base64')}`
}

function sealedEnvelope(value: string): string {
  return `${PREFIX}encrypted:${safeStorageMock.encryptString(value).toString('base64')}`
}

function createStore(requireSealing?: boolean) {
  return createEncryptedApiKeyFileStore({
    fileName: 'fixture-api-key.enc',
    envelopePrefix: PREFIX,
    providerLabel: 'Fixture',
    logScope: 'fixture',
    ...(requireSealing === undefined ? {} : { requireSealing })
  })
}

function allWrittenText(): string {
  return fixtureFs.writes.map((write) => write.contents).join('\n')
}

beforeEach(() => {
  fixtureFs.files.clear()
  fixtureFs.writes.length = 0
  safeStorageMock.isEncryptionAvailable.mockReset()
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.decryptString.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Why: MiniMax and OpenCode-Go call the factory without the option and keep their plaintext fallback.
describe.each([
  ['omitted', undefined],
  ['false', false]
] as const)('createEncryptedApiKeyFileStore with requireSealing %s', (_label, requireSealing) => {
  it('seals the key when encryption is available', () => {
    const store = createStore(requireSealing)
    store.save(FIXTURE_ONLY_KEY)
    expect(fixtureFs.files.get(KEY_PATH)).toBe(sealedEnvelope(FIXTURE_ONLY_KEY))
    expect(store.protection()).toBe('sealed')
  })

  it('still writes a plaintext envelope, with a warning, when encryption is unavailable', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = createStore(requireSealing)
    store.save(FIXTURE_ONLY_KEY)
    expect(fixtureFs.files.get(KEY_PATH)).toBe(plaintextEnvelope(FIXTURE_ONLY_KEY))
    expect(store.protection()).toBe('plaintext')
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      expect.stringContaining('storing Fixture API key in plaintext')
    )
  })

  it('still reads a plaintext envelope back', () => {
    fixtureFs.files.set(KEY_PATH, plaintextEnvelope(FIXTURE_ONLY_KEY))
    expect(createStore(requireSealing).read()).toBe(FIXTURE_ONLY_KEY)
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })
})

describe('createEncryptedApiKeyFileStore with requireSealing true', () => {
  it('throws a typed error before any write when encryption is unavailable', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = createStore(true)
    let thrown: unknown
    try {
      store.save(FIXTURE_ONLY_KEY)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ApiKeySealingUnavailableError)
    expect(String(thrown)).not.toContain(FIXTURE_ONLY_KEY)
    expect(fixtureFs.writes).toEqual([])
    expect(fixtureFs.files.size).toBe(0)
    expect(store.read()).toBeNull()
  })

  it('never writes a plaintext envelope and does not warn about storing one', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    expect(() => createStore(true).save(FIXTURE_ONLY_KEY)).toThrow(ApiKeySealingUnavailableError)
    expect(allWrittenText()).not.toContain('plaintext')
    expect(vi.mocked(console.warn)).not.toHaveBeenCalled()
  })

  it('seals and reads the key back when encryption is available', () => {
    const store = createStore(true)
    store.save(FIXTURE_ONLY_KEY)
    expect(fixtureFs.files.get(KEY_PATH)).toBe(sealedEnvelope(FIXTURE_ONLY_KEY))
    expect(createStore(true).read()).toBe(FIXTURE_ONLY_KEY)
  })

  it('refuses to read a plaintext envelope and reports it as plaintext', () => {
    fixtureFs.files.set(KEY_PATH, plaintextEnvelope(FIXTURE_ONLY_KEY))
    const store = createStore(true)
    let thrown: unknown
    try {
      store.read()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(String(thrown)).toMatch(/could not be decrypted/)
    expect(String(thrown)).not.toContain(FIXTURE_ONLY_KEY)
    expect(store.protection()).toBe('plaintext')
  })

  it('does not cache a refused plaintext read, so a later sealed write is the value read', () => {
    fixtureFs.files.set(KEY_PATH, plaintextEnvelope(FIXTURE_ONLY_KEY))
    const store = createStore(true)
    expect(() => store.read()).toThrow()
    fixtureFs.files.set(KEY_PATH, sealedEnvelope('FAKE_API_KEY_FIXTURE_ONLY_1111111111'))
    expect(store.read()).toBe('FAKE_API_KEY_FIXTURE_ONLY_1111111111')
  })
})

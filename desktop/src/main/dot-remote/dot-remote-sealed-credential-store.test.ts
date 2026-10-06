import type * as FsModule from 'node:fs'
import type * as OsModule from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtureFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writes: [] as string[],
  failWrites: false
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
    if (fixtureFs.failWrites) {
      throw new Error('fixture write failure')
    }
    fixtureFs.writes.push(contents)
    fixtureFs.files.set(path, contents)
    return true
  }
}))

import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import { createDotRemoteSealedCredentialStore } from './dot-remote-sealed-credential-store'

// FIXTURE_ONLY: an obviously fake token; never a real credential.
const FIXTURE_ONLY_TOKEN = 'FIXTURE_ONLY_sites_service_token_0000000000'
const TOKEN_PATH = join('fixture-home', '.nash', 'dot-remote-service-token.enc')
const PREFIX = 'nash-dot-remote-service-token:v1:'
const protectionGap = vi.fn((): string | null => null)

function loggedText(): string {
  return (['log', 'info', 'warn', 'error', 'debug'] as const)
    .map((channel) => inspect(vi.mocked(console[channel]).mock.calls, { depth: 10 }))
    .join('\n')
}

describe('dot remote sealed credential store', () => {
  beforeEach(() => {
    fixtureFs.files.clear()
    fixtureFs.writes.length = 0
    fixtureFs.failWrites = false
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    protectionGap.mockReturnValue(null)
    setSecretStore({
      isEncryptionAvailable: () => safeStorageMock.isEncryptionAvailable(),
      encryptString: (plainText) => safeStorageMock.encryptString(plainText),
      decryptString: (cipher) => safeStorageMock.decryptString(cipher),
      describeProtectionGap: () => protectionGap()
    })
    for (const channel of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, channel).mockImplementation(() => undefined)
    }
  })
  afterEach(() => {
    _resetSecretStoreForTests()
    vi.restoreAllMocks()
  })

  it('is absent until a token is saved, then sealed under the NASH home folder', () => {
    const store = createDotRemoteSealedCredentialStore()
    expect(store.status()).toEqual({ present: false, protection: 'absent' })
    expect(store.read()).toBeNull()
    expect(store.save(FIXTURE_ONLY_TOKEN)).toEqual({ ok: true })
    expect(store.status()).toEqual({ present: true, protection: 'sealed' })
    expect([...fixtureFs.files.keys()]).toEqual([TOKEN_PATH])
    expect(fixtureFs.files.get(TOKEN_PATH)?.startsWith(`${PREFIX}encrypted:`)).toBe(true)
    expect(fixtureFs.writes.join('\n')).not.toContain(FIXTURE_ONLY_TOKEN)
    expect(fixtureFs.writes.join('\n')).not.toContain(
      Buffer.from(FIXTURE_ONLY_TOKEN).toString('base64')
    )
    expect(store.read()?.authorizationHeader()).toBe(`Bearer ${FIXTURE_ONLY_TOKEN}`)
  })

  it('stores nothing, not even plaintext, when sealing is unavailable', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = createDotRemoteSealedCredentialStore()
    expect(store.save(FIXTURE_ONLY_TOKEN)).toEqual({ ok: false, code: 'sealing_unavailable' })
    expect(fixtureFs.files.size).toBe(0)
    expect(store.status().protection).toBe('sealing_unavailable')
  })

  it('stores nothing while the host reports a protection gap', () => {
    protectionGap.mockReturnValue('fixture gap')
    const store = createDotRemoteSealedCredentialStore()
    expect(store.save(FIXTURE_ONLY_TOKEN)).toEqual({ ok: false, code: 'sealing_unavailable' })
    expect(fixtureFs.files.size).toBe(0)
  })

  it('refuses a plaintext envelope left on disk and never reads it', () => {
    fixtureFs.files.set(
      TOKEN_PATH,
      `${PREFIX}plaintext:${Buffer.from(FIXTURE_ONLY_TOKEN).toString('base64')}`
    )
    const store = createDotRemoteSealedCredentialStore()
    expect(store.status()).toEqual({ present: true, protection: 'plaintext_refused' })
    expect(store.read()).toBeNull()
  })

  it('refuses a malformed token by code before writing', () => {
    const store = createDotRemoteSealedCredentialStore()
    expect(store.save('short')).toEqual({ ok: false, code: 'token_too_short' })
    expect(fixtureFs.writes).toEqual([])
  })

  it('reports a failed write and leaves no file behind', () => {
    fixtureFs.failWrites = true
    const store = createDotRemoteSealedCredentialStore()
    expect(store.save(FIXTURE_ONLY_TOKEN)).toEqual({ ok: false, code: 'write_failed' })
    expect(fixtureFs.files.size).toBe(0)
  })

  it('clears the token', () => {
    const store = createDotRemoteSealedCredentialStore()
    store.save(FIXTURE_ONLY_TOKEN)
    expect(store.clear()).toEqual({ ok: true })
    expect(store.status().present).toBe(false)
  })

  it('logs no token value on any path', () => {
    const store = createDotRemoteSealedCredentialStore()
    store.save(FIXTURE_ONLY_TOKEN)
    fixtureFs.failWrites = true
    store.save(FIXTURE_ONLY_TOKEN)
    store.read()
    expect(loggedText()).not.toContain(FIXTURE_ONLY_TOKEN)
  })
})

// FIXTURE_ONLY: obviously fake device credentials in the contract shape.
const FIXTURE_ONLY_DEVICE =
  'ndc_0123456789abcdef01234567.FIXTUREdeviceCredentialSecret00000000000000000001'
const FIXTURE_ONLY_ROTATED =
  'ndc_89abcdef0123456789abcdef.FIXTUREdeviceCredentialSecret00000000000000000002'
const DEVICE_PATH = join('fixture-home', '.nash', 'dot-remote-device-credential.enc')
const DEVICE_PREFIX = 'nash-dot-remote-device-credential:v1:'

describe('dot remote sealed device credential', () => {
  beforeEach(() => {
    fixtureFs.files.clear()
    fixtureFs.writes.length = 0
    fixtureFs.failWrites = false
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    protectionGap.mockReturnValue(null)
    setSecretStore({
      isEncryptionAvailable: () => safeStorageMock.isEncryptionAvailable(),
      encryptString: (plainText) => safeStorageMock.encryptString(plainText),
      decryptString: (cipher) => safeStorageMock.decryptString(cipher),
      describeProtectionGap: () => protectionGap()
    })
    for (const channel of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, channel).mockImplementation(() => undefined)
    }
  })
  afterEach(() => {
    _resetSecretStoreForTests()
    vi.restoreAllMocks()
  })

  it('seals the credential in its own file and reads it back as a redacting handle', () => {
    const store = createDotRemoteSealedCredentialStore()
    expect(store.readDevice()).toBeNull()
    expect(store.saveDevice(FIXTURE_ONLY_DEVICE)).toEqual({ ok: true })
    expect([...fixtureFs.files.keys()]).toEqual([DEVICE_PATH])
    expect(fixtureFs.files.get(DEVICE_PATH)?.startsWith(`${DEVICE_PREFIX}encrypted:`)).toBe(true)
    expect(fixtureFs.writes.join('\n')).not.toContain('FIXTUREdeviceCredentialSecret')
    const handle = store.readDevice()
    expect(handle?.headerValue()).toBe(FIXTURE_ONLY_DEVICE)
    expect(inspect({ handle })).not.toContain(FIXTURE_ONLY_DEVICE)
  })

  it('replaces the stored credential when it rotates', () => {
    const store = createDotRemoteSealedCredentialStore()
    store.saveDevice(FIXTURE_ONLY_DEVICE)
    expect(store.saveDevice(FIXTURE_ONLY_ROTATED)).toEqual({ ok: true })
    expect(store.readDevice()?.headerValue()).toBe(FIXTURE_ONLY_ROTATED)
    expect(createDotRemoteSealedCredentialStore().readDevice()?.headerValue()).toBe(
      FIXTURE_ONLY_ROTATED
    )
  })

  it('refuses a value outside the contract shape before writing', () => {
    const store = createDotRemoteSealedCredentialStore()
    expect(store.saveDevice('ndc_short.value')).toEqual({ ok: false, code: 'credential_invalid' })
    expect(fixtureFs.writes).toEqual([])
  })

  it('stores nothing, not even plaintext, when sealing is unavailable', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = createDotRemoteSealedCredentialStore()
    expect(store.saveDevice(FIXTURE_ONLY_DEVICE)).toEqual({
      ok: false,
      code: 'sealing_unavailable'
    })
    expect(fixtureFs.files.size).toBe(0)
    expect(store.readDevice()).toBeNull()
  })

  it('reports a failed write and keeps no credential', () => {
    fixtureFs.failWrites = true
    const store = createDotRemoteSealedCredentialStore()
    expect(store.saveDevice(FIXTURE_ONLY_DEVICE)).toEqual({ ok: false, code: 'write_failed' })
    expect(store.readDevice()).toBeNull()
  })

  it('refuses a plaintext envelope left on disk', () => {
    fixtureFs.files.set(
      DEVICE_PATH,
      `${DEVICE_PREFIX}plaintext:${Buffer.from(FIXTURE_ONLY_DEVICE).toString('base64')}`
    )
    expect(createDotRemoteSealedCredentialStore().readDevice()).toBeNull()
  })

  it('clears the credential and leaves the service token in place', () => {
    const store = createDotRemoteSealedCredentialStore()
    store.save(FIXTURE_ONLY_TOKEN)
    store.saveDevice(FIXTURE_ONLY_DEVICE)
    expect(store.clearDevice()).toEqual({ ok: true })
    expect(store.readDevice()).toBeNull()
    expect(store.status()).toEqual({ present: true, protection: 'sealed' })
  })

  it('logs no credential value on any path', () => {
    const store = createDotRemoteSealedCredentialStore()
    store.saveDevice(FIXTURE_ONLY_DEVICE)
    fixtureFs.failWrites = true
    store.saveDevice(FIXTURE_ONLY_ROTATED)
    store.readDevice()
    expect(loggedText()).not.toContain('FIXTUREdeviceCredentialSecret')
  })
})

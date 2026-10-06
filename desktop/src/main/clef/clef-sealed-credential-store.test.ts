import type * as FsModule from 'node:fs'
import type * as OsModule from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtureFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failingWrites: new Set<string>(),
  failingRemovals: new Set<string>(),
  // Why: every content handed to the writer, so a test can prove which envelopes ever reached disk.
  writes: [] as string[],
  // Why: lets a test make the thrown error carry text the way a hostile or buggy dependency could.
  failure: { write: null as unknown, removal: null as unknown }
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
    if (fixtureFs.failingRemovals.has(String(path))) {
      throw fixtureFs.failure.removal ?? new Error('fixture remove failure')
    }
    fixtureFs.files.delete(String(path))
  }
}))

vi.mock('../../shared/secure-file', () => ({
  hardenExistingSecureFile: () => undefined,
  isUnreadableError: () => false,
  writeSecureFile: (path: string, contents: string) => {
    if (fixtureFs.failingWrites.has(path)) {
      throw fixtureFs.failure.write ?? new Error('fixture write failure')
    }
    fixtureFs.writes.push(contents)
    fixtureFs.files.set(path, contents)
    return true
  }
}))

import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import { ClefCredentialGeneration } from './clef-credential-generation'
import { createClefSealedCredentialStore } from './clef-sealed-credential-store'

// FIXTURE_ONLY: fake values shaped like real Clef credentials; never real secrets.
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'

const TOKEN_PATH = join('fixture-home', '.nash','clef-api-token.enc')
const ACCOUNT_PATH = join('fixture-home', '.nash','clef-account-id.enc')
const TOKEN_PREFIX = 'orca-clef-api-token:v1:'
const ACCOUNT_PREFIX = 'orca-clef-account-id:v1:'

function sealedEnvelope(prefix: string, value: string): string {
  return `${prefix}encrypted:${safeStorageMock.encryptString(value).toString('base64')}`
}

function plaintextEnvelope(prefix: string, value: string): string {
  return `${prefix}plaintext:${Buffer.from(value, 'utf8').toString('base64')}`
}

const CONSOLE_CHANNELS = ['log', 'info', 'warn', 'error', 'debug'] as const
const FORBIDDEN_LOG_TEXT = [
  FIXTURE_ONLY_TOKEN,
  FIXTURE_ONLY_ACCOUNT_ID,
  Buffer.from(FIXTURE_ONLY_TOKEN).toString('base64'),
  Buffer.from(FIXTURE_ONLY_ACCOUNT_ID).toString('base64')
]

/** Every console channel and argument, with Error messages, stacks and causes expanded. */
function loggedText(): string {
  return CONSOLE_CHANNELS.map((channel) =>
    inspect(vi.mocked(console[channel]).mock.calls, { depth: 10, maxArrayLength: null })
  ).join('\n')
}

function expectNoSecretLogged(): void {
  const logged = loggedText()
  for (const forbidden of FORBIDDEN_LOG_TEXT) {
    expect(logged).not.toContain(forbidden)
  }
}

/** An error that carries both secrets in its message and nested causes. */
function secretBearingError(label: string): Error {
  const inner = new Error(
    `inner ${label} ${FIXTURE_ONLY_TOKEN} accounts/${FIXTURE_ONLY_ACCOUNT_ID}`
  )
  return new Error(`${label} Bearer ${FIXTURE_ONLY_TOKEN}`, {
    cause: new Error(label, { cause: inner })
  })
}

// Why delegating: production's ElectronSecretStore is a pass-through to safeStorage; only the gap is separate.
const protectionGap = vi.fn((): string | null => null)

function installSecretStorePort(): void {
  setSecretStore({
    isEncryptionAvailable: () => safeStorageMock.isEncryptionAvailable(),
    encryptString: (plainText) => safeStorageMock.encryptString(plainText),
    decryptString: (cipher) => safeStorageMock.decryptString(cipher),
    describeProtectionGap: () => protectionGap()
  })
}

function resetFixtureState(): void {
  fixtureFs.files.clear()
  fixtureFs.writes.length = 0
  fixtureFs.failingWrites.clear()
  fixtureFs.failingRemovals.clear()
  fixtureFs.failure.write = null
  fixtureFs.failure.removal = null
  safeStorageMock.isEncryptionAvailable.mockReset()
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.decryptString.mockClear()
  protectionGap.mockReset()
  protectionGap.mockReturnValue(null)
  installSecretStorePort()
  for (const channel of CONSOLE_CHANNELS) {
    vi.spyOn(console, channel).mockImplementation(() => undefined)
  }
}

function storeSealedPair(): void {
  fixtureFs.files.set(TOKEN_PATH, sealedEnvelope(TOKEN_PREFIX, FIXTURE_ONLY_TOKEN))
  fixtureFs.files.set(ACCOUNT_PATH, sealedEnvelope(ACCOUNT_PREFIX, FIXTURE_ONLY_ACCOUNT_ID))
}

describe('createClefSealedCredentialStore', () => {
  beforeEach(resetFixtureState)

  afterEach(() => {
    vi.restoreAllMocks()
    _resetSecretStoreForTests()
  })

  it('sees a secret inside an Error cause on any console channel, which JSON.stringify would miss', () => {
    console.debug('probe', secretBearingError('probe'))
    expect(loggedText()).toContain(FIXTURE_ONLY_TOKEN)
    expect(JSON.stringify(vi.mocked(console.debug).mock.calls)).not.toContain(FIXTURE_ONLY_TOKEN)
    expect(() => expectNoSecretLogged()).toThrow()
  })

  it('reports absent and reads nothing when no credentials are stored', () => {
    const store = createClefSealedCredentialStore()
    expect(store.status()).toEqual({
      tokenPresent: false,
      accountPresent: false,
      protection: 'absent'
    })
    expect(store.read()).toBeNull()
  })

  it('reports sealing_unavailable when nothing is stored and the keyring is unusable', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    expect(createClefSealedCredentialStore().status().protection).toBe('sealing_unavailable')
  })

  it('seals both values and returns a handle that exposes them only to the transport', () => {
    const store = createClefSealedCredentialStore()
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({ ok: true })

    expect(fixtureFs.files.get(TOKEN_PATH)?.startsWith(`${TOKEN_PREFIX}encrypted:`)).toBe(true)
    expect(fixtureFs.files.get(ACCOUNT_PATH)?.startsWith(`${ACCOUNT_PREFIX}encrypted:`)).toBe(true)
    for (const contents of fixtureFs.files.values()) {
      const payload = Buffer.from(contents.split(':').at(-1) ?? '', 'base64').toString('utf8')
      expect(payload).not.toContain(FIXTURE_ONLY_TOKEN)
      expect(payload).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
    }
    expect(store.status()).toEqual({
      tokenPresent: true,
      accountPresent: true,
      protection: 'sealed'
    })

    const handle = createClefSealedCredentialStore().read()
    expect(handle?.authorizationHeader()).toBe(`Bearer ${FIXTURE_ONLY_TOKEN}`)
    expect(handle?.accountPath()).toBe(`accounts/${FIXTURE_ONLY_ACCOUNT_ID}`)
    expect(String(handle)).toBe('[redacted clef credential]')
  })

  it('trims surrounding whitespace before validating and sealing', () => {
    const store = createClefSealedCredentialStore()
    expect(store.save(`  ${FIXTURE_ONLY_TOKEN}\n`, ` ${FIXTURE_ONLY_ACCOUNT_ID} `)).toEqual({
      ok: true
    })
    expect(store.read()?.accountPath()).toBe(`accounts/${FIXTURE_ONLY_ACCOUNT_ID}`)
  })

  it('refuses to save when sealing is unavailable and writes nothing', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = createClefSealedCredentialStore()
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({
      ok: false,
      code: 'sealing_unavailable'
    })
    expect(fixtureFs.files.size).toBe(0)
  })

  it('validates both values before writing either one', () => {
    const store = createClefSealedCredentialStore()
    expect(store.save(FIXTURE_ONLY_TOKEN, 'NOT-A-HEX-ACCOUNT')).toEqual({
      ok: false,
      code: 'account_id_invalid_format'
    })
    expect(store.save('too short', FIXTURE_ONLY_ACCOUNT_ID)).toEqual({
      ok: false,
      code: 'token_too_short'
    })
    expect(fixtureFs.files.size).toBe(0)
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled()
  })

  it('leaves neither value stored when the second write fails', () => {
    storeSealedPair()
    fixtureFs.failingWrites.add(ACCOUNT_PATH)
    fixtureFs.failure.write = secretBearingError('second write failed')
    const store = createClefSealedCredentialStore()
    expect(store.save(`${FIXTURE_ONLY_TOKEN}1`, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({
      ok: false,
      code: 'write_failed'
    })
    expect(fixtureFs.files.size).toBe(0)
    expect(store.status().protection).toBe('absent')
    expect(store.read()).toBeNull()
    expect(loggedText()).toContain('[clef] failed to write sealed credentials')
    expectNoSecretLogged()
  })

  it('leaves neither value stored when the first write fails', () => {
    storeSealedPair()
    fixtureFs.failingWrites.add(TOKEN_PATH)
    fixtureFs.failure.write = secretBearingError('first write failed')
    const store = createClefSealedCredentialStore()
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({
      ok: false,
      code: 'write_failed'
    })
    expect(fixtureFs.files.size).toBe(0)
    expectNoSecretLogged()
  })

  it('never writes a plaintext envelope when sealing drops mid-save', () => {
    // Why state-based: the keyring is lost once the first value is stored, however many checks ran before.
    safeStorageMock.isEncryptionAvailable.mockImplementation(() => !fixtureFs.files.has(TOKEN_PATH))
    const store = createClefSealedCredentialStore()
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({
      ok: false,
      code: 'sealing_unavailable'
    })
    expect(fixtureFs.writes.length).toBeGreaterThan(0)
    expect(fixtureFs.writes.filter((contents) => contents.includes('plaintext:'))).toEqual([])
    expect(fixtureFs.files.size).toBe(0)
    expectNoSecretLogged()
  })

  it('refuses to save and reports sealing_unavailable when the secret store reports a protection gap', () => {
    protectionGap.mockReturnValue('The OS keyring protects nothing here.')
    const store = createClefSealedCredentialStore()
    const before = store.generation()
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({
      ok: false,
      code: 'sealing_unavailable'
    })
    expect(fixtureFs.writes).toEqual([])
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled()
    expect(store.generation().equals(before)).toBe(true)
  })

  it('reports sealing_unavailable and reads nothing when sealed files exist but the secret store reports a gap', () => {
    storeSealedPair()
    protectionGap.mockReturnValue('The OS keyring protects nothing here.')
    const store = createClefSealedCredentialStore()
    expect(store.status().protection).toBe('sealing_unavailable')
    expect(store.read()).toBeNull()
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it.each([
    ['is not installed', () => _resetSecretStoreForTests()],
    [
      'throws',
      () =>
        setSecretStore({
          isEncryptionAvailable: () => {
            throw new Error('fixture port failure')
          },
          encryptString: () => Buffer.alloc(0),
          decryptString: () => '',
          describeProtectionGap: () => null
        })
    ]
  ])('fails closed on every call when the secret store %s', (_label, breakPort) => {
    breakPort()
    const store = createClefSealedCredentialStore()
    expect(store.status().protection).toBe('sealing_unavailable')
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({
      ok: false,
      code: 'sealing_unavailable'
    })
    expect(fixtureFs.writes).toEqual([])
  })

  it('refuses a plaintext token envelope even though the upstream store could read it', () => {
    fixtureFs.files.set(TOKEN_PATH, plaintextEnvelope(TOKEN_PREFIX, FIXTURE_ONLY_TOKEN))
    fixtureFs.files.set(ACCOUNT_PATH, sealedEnvelope(ACCOUNT_PREFIX, FIXTURE_ONLY_ACCOUNT_ID))
    const store = createClefSealedCredentialStore()
    expect(store.status()).toEqual({
      tokenPresent: true,
      accountPresent: true,
      protection: 'plaintext_refused'
    })
    expect(store.read()).toBeNull()
  })

  it('refuses a plaintext account envelope', () => {
    fixtureFs.files.set(TOKEN_PATH, sealedEnvelope(TOKEN_PREFIX, FIXTURE_ONLY_TOKEN))
    fixtureFs.files.set(ACCOUNT_PATH, plaintextEnvelope(ACCOUNT_PREFIX, FIXTURE_ONLY_ACCOUNT_ID))
    const store = createClefSealedCredentialStore()
    expect(store.status().protection).toBe('plaintext_refused')
    expect(store.read()).toBeNull()
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('refuses an envelope it cannot classify as sealed', () => {
    fixtureFs.files.set(TOKEN_PATH, 'not an orca envelope')
    fixtureFs.files.set(ACCOUNT_PATH, sealedEnvelope(ACCOUNT_PREFIX, FIXTURE_ONLY_ACCOUNT_ID))
    const store = createClefSealedCredentialStore()
    expect(store.status().protection).toBe('plaintext_refused')
    expect(store.read()).toBeNull()
  })

  it('reports sealing_unavailable and reads nothing when sealed files exist but the keyring is gone', () => {
    storeSealedPair()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = createClefSealedCredentialStore()
    expect(store.status()).toEqual({
      tokenPresent: true,
      accountPresent: true,
      protection: 'sealing_unavailable'
    })
    expect(store.read()).toBeNull()
  })

  it('reads nothing when only one of the two values is stored', () => {
    fixtureFs.files.set(TOKEN_PATH, sealedEnvelope(TOKEN_PREFIX, FIXTURE_ONLY_TOKEN))
    const store = createClefSealedCredentialStore()
    expect(store.status()).toEqual({
      tokenPresent: true,
      accountPresent: false,
      protection: 'sealed'
    })
    expect(store.read()).toBeNull()
  })

  it('reads nothing when a sealed value fails shape validation', () => {
    fixtureFs.files.set(TOKEN_PATH, sealedEnvelope(TOKEN_PREFIX, FIXTURE_ONLY_TOKEN))
    fixtureFs.files.set(ACCOUNT_PATH, sealedEnvelope(ACCOUNT_PREFIX, 'TAMPERED'))
    expect(createClefSealedCredentialStore().read()).toBeNull()
    expect(loggedText()).toContain('failed shape validation')
    expectNoSecretLogged()
  })

  it('reads nothing and logs without values when unsealing fails', () => {
    storeSealedPair()
    // Why no secret in the error: the upstream store logs it unscrubbed, and a keyring never echoes plaintext.
    safeStorageMock.decryptString.mockImplementationOnce(() => {
      throw new Error('fixture keyring failure')
    })
    expect(createClefSealedCredentialStore().read()).toBeNull()
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      '[clef] sealed credentials could not be unsealed'
    )
    expect(loggedText()).toContain('[clef] failed to decode/decrypt API key')
    expectNoSecretLogged()
  })

  it('clears both values and forgets anything it had read', () => {
    const store = createClefSealedCredentialStore()
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({ ok: true })
    expect(store.read()).not.toBeNull()
    expect(store.clear()).toEqual({ ok: true })
    expect(fixtureFs.files.size).toBe(0)
    expect(store.status().protection).toBe('absent')
    expect(store.read()).toBeNull()
  })

  it('still removes the second value when removing the first fails, and reports it', () => {
    storeSealedPair()
    fixtureFs.failingRemovals.add(TOKEN_PATH)
    const store = createClefSealedCredentialStore()
    expect(store.clear()).toEqual({ ok: false, code: 'clear_failed' })
    expect(fixtureFs.files.has(ACCOUNT_PATH)).toBe(false)
    expect(store.read()).toBeNull()
  })

  it('logs a failed removal without the error text it carried', () => {
    storeSealedPair()
    fixtureFs.failingRemovals.add(TOKEN_PATH)
    fixtureFs.failure.removal = secretBearingError('remove failed')
    expect(createClefSealedCredentialStore().clear()).toEqual({ ok: false, code: 'clear_failed' })
    expect(loggedText()).toContain('[clef] failed to remove a sealed credential file')
    expectNoSecretLogged()
  })
})

describe('createClefSealedCredentialStore credential generation', () => {
  beforeEach(resetFixtureState)

  afterEach(() => {
    vi.restoreAllMocks()
    _resetSecretStoreForTests()
  })

  it('is an opaque generation that stays put across status and read calls', () => {
    storeSealedPair()
    const store = createClefSealedCredentialStore()
    const first = store.generation()
    expect(first).toBeInstanceOf(ClefCredentialGeneration)
    store.status()
    store.read()
    expect(store.generation().equals(first)).toBe(true)
  })

  it('differs between store instances, so one cannot lift another latch', () => {
    const first = createClefSealedCredentialStore().generation()
    expect(createClefSealedCredentialStore().generation().equals(first)).toBe(false)
  })

  it('changes on every save, even one that stores the same values again', () => {
    const store = createClefSealedCredentialStore()
    const before = store.generation()
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({ ok: true })
    const afterFirst = store.generation()
    expect(afterFirst.equals(before)).toBe(false)
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({ ok: true })
    expect(store.generation().equals(afterFirst)).toBe(false)
  })

  it('changes on a save that fails after writing began, because the files may have changed', () => {
    storeSealedPair()
    fixtureFs.failingWrites.add(ACCOUNT_PATH)
    const store = createClefSealedCredentialStore()
    const before = store.generation()
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({
      ok: false,
      code: 'write_failed'
    })
    expect(store.generation().equals(before)).toBe(false)
  })

  it('changes when sealing drops mid-save and both values are removed', () => {
    safeStorageMock.isEncryptionAvailable
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    const store = createClefSealedCredentialStore()
    const before = store.generation()
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID).ok).toBe(false)
    expect(store.generation().equals(before)).toBe(false)
  })

  it('changes on every clear, including one that fails part way', () => {
    storeSealedPair()
    const store = createClefSealedCredentialStore()
    const before = store.generation()
    expect(store.clear()).toEqual({ ok: true })
    const afterClear = store.generation()
    expect(afterClear.equals(before)).toBe(false)

    storeSealedPair()
    fixtureFs.failingRemovals.add(TOKEN_PATH)
    expect(store.clear()).toEqual({ ok: false, code: 'clear_failed' })
    expect(store.generation().equals(afterClear)).toBe(false)
  })

  it('keeps the generation when a save is refused before anything is written', () => {
    const store = createClefSealedCredentialStore()
    const before = store.generation()
    expect(store.save('too short', FIXTURE_ONLY_ACCOUNT_ID).ok).toBe(false)
    expect(store.save(FIXTURE_ONLY_TOKEN, 'NOT-A-HEX-ACCOUNT').ok).toBe(false)
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    expect(store.save(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)).toEqual({
      ok: false,
      code: 'sealing_unavailable'
    })
    expect(store.generation().equals(before)).toBe(true)
  })
})

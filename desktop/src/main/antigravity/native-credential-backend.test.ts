import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { credential } from './native-account-test-fixtures'
import {
  createAntigravityFileCredentialBackend,
  createAntigravityHostCredentialBackend,
  isAntigravityFileStorageHost
} from './native-credential-backend'
import { parseAntigravityNativeCredential } from './native-credential-codec'
import {
  readAntigravityWindowsCredential,
  writeAntigravityWindowsCredential
} from './native-windows-credentials'

vi.mock('./native-macos-credentials', () => ({
  readAntigravityMacOSCredential: vi.fn(),
  writeAntigravityMacOSCredential: vi.fn()
}))
vi.mock('./native-windows-credentials', () => ({
  readAntigravityWindowsCredential: vi.fn(),
  writeAntigravityWindowsCredential: vi.fn()
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(readAntigravityWindowsCredential).mockReset()
  vi.mocked(writeAntigravityWindowsCredential).mockReset()
})

const AUTHORITY_DETECTORS = [
  'SSH_TTY',
  'SSH_CLIENT',
  'SSH_CONNECTION',
  'WSL_DISTRO_NAME',
  'WSL_INTEROP'
]

function clearAuthorityDetectors(): void {
  for (const key of AUTHORITY_DETECTORS) {
    vi.stubEnv(key, '')
  }
}

async function withWindowsHome(run: (home: string, marker: string) => Promise<void>) {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  clearAuthorityDetectors()
  const home = mkdtempSync(join(tmpdir(), 'orca-agy-windows-home-'))
  const marker = join(
    home,
    '.gemini',
    'antigravity-cli',
    'cache',
    'antigravity-keyring-unavailable'
  )
  try {
    await run(home, marker)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function plantMarker(marker: string): void {
  mkdirSync(dirname(marker), { recursive: true })
  writeFileSync(marker, '')
}

describe('execution-host native credential authority', () => {
  it('performs a real isolated file write/readback and detects a stale before-write credential', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-agy-backend-test-'))
    try {
      const path = join(dir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token')
      const backend = createAntigravityFileCredentialBackend(path)
      await backend.write(credential('a'), null)
      expect((await backend.read())?.identity?.subject).toBe('a')
      await backend.write(credential('b'), credential('a'))
      expect(readFileSync(path, 'utf8')).toBe(credential('b'))
      await expect(backend.write(credential('a'), credential('a'))).rejects.toThrow(
        'changed during selection'
      )
      expect(readFileSync(path, 'utf8')).toBe(credential('b'))
      if (process.platform !== 'win32') {
        expect(statSync(path).mode & 0o077).toBe(0)
        chmodSync(path, 0o644)
        await expect(backend.read()).rejects.toThrow('read safely')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(['SSH_TTY', 'SSH_CLIENT', 'SSH_CONNECTION', 'WSL_DISTRO_NAME', 'WSL_INTEROP'])(
    'uses the owning-host file bypass detector %s',
    (key) => {
      expect(isAntigravityFileStorageHost({ [key]: 'present' })).toBe(true)
      expect(isAntigravityFileStorageHost({ [key]: '' })).toBe(false)
    }
  )

  it('recognizes WSL kernel evidence and never guesses file mode from Linux alone', () => {
    expect(isAntigravityFileStorageHost({}, '6.6-microsoft-standard-WSL2')).toBe(true)
    expect(isAntigravityFileStorageHost({}, '6.8-linux')).toBe(false)
  })

  it('refuses the Windows file bypass until private ACL protection is verified', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.stubEnv('SSH_CLIENT', 'task-host')
    expect(() => createAntigravityHostCredentialBackend('/task-home')).toThrow(
      'cannot yet verify that file is private on Windows'
    )
    expect(readAntigravityWindowsCredential).not.toHaveBeenCalled()
  })

  it('capability-refuses unverified native Linux without mutating client credentials', () => {
    clearAuthorityDetectors()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(() => createAntigravityHostCredentialBackend('/task-home')).toThrow(
      'not supported on this host yet'
    )
  })

  it('reads native Windows accounts from Credential Manager; a missing item is signed out', () =>
    withWindowsHome(async (home) => {
      const backend = createAntigravityHostCredentialBackend(home)
      vi.mocked(readAntigravityWindowsCredential).mockResolvedValueOnce(null)
      expect(await backend.read()).toBeNull()
      const current = parseAntigravityNativeCredential(credential('a'))
      vi.mocked(readAntigravityWindowsCredential).mockResolvedValueOnce(current)
      expect(await backend.read()).toBe(current)
      expect(readAntigravityWindowsCredential).toHaveBeenCalledTimes(2)
    }))

  it('delegates Windows writes with the expected value for compare and read-back', () =>
    withWindowsHome(async (home) => {
      const backend = createAntigravityHostCredentialBackend(home)
      await backend.write(credential('b'), credential('a'))
      await backend.write(credential('a'), null)
      expect(vi.mocked(writeAntigravityWindowsCredential).mock.calls).toEqual([
        [credential('b'), credential('a')],
        [credential('a'), null]
      ])
    }))

  it('refuses Windows reads and writes while agy reports a keyring fallback marker', () =>
    withWindowsHome(async (home, marker) => {
      const backend = createAntigravityHostCredentialBackend(home)
      plantMarker(marker)
      await expect(backend.read()).rejects.toThrow('keyring fallback marker')
      await expect(backend.write(credential('b'), credential('a'))).rejects.toThrow(
        'keyring fallback marker'
      )
      expect(readAntigravityWindowsCredential).not.toHaveBeenCalled()
      expect(writeAntigravityWindowsCredential).not.toHaveBeenCalled()
    }))

  it('reports a conflict when agy falls back to its file during a Windows write', () =>
    withWindowsHome(async (home, marker) => {
      const backend = createAntigravityHostCredentialBackend(home)
      vi.mocked(writeAntigravityWindowsCredential).mockImplementationOnce(async () => {
        plantMarker(marker)
      })
      await expect(backend.write(credential('b'), credential('a'))).rejects.toThrow(
        'changed during selection'
      )
    }))
})

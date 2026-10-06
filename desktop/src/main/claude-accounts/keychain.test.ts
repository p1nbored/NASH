import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as keychain from './keychain'
import {
  readActiveClaudeKeychainCredentials,
  readActiveClaudeKeychainCredentialsStrict
} from './keychain'

vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}))

const execFileMock = vi.mocked(execFile)
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const originalUser = process.env.USER
const originalUsername = process.env.USERNAME
const TEST_USER = 'orca-test-user'
const SSO_USER = 'sso.user@example.com'
let configDir: string

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

function serviceForConfigDir(configDir: string): string {
  const suffix = createHash('sha256').update(configDir).digest('hex').slice(0, 8)
  return `Claude Code-credentials-${suffix}`
}

function invokeExecFileCallback(
  callback: unknown,
  error: Error | null,
  stdout: string,
  stderr: string
): void {
  const execCallback = callback as (error: Error | null, stdout: string, stderr: string) => void
  execCallback(error, stdout, stderr)
}

describe('Claude Keychain credentials', () => {
  beforeEach(() => {
    configDir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-claude-keychain-')))
    setPlatform('darwin')
    execFileMock.mockReset()
    process.env.USER = TEST_USER
    delete process.env.USERNAME
  })

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true })
    vi.useRealTimers()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    if (originalUser === undefined) {
      delete process.env.USER
    } else {
      process.env.USER = originalUser
    }
    if (originalUsername === undefined) {
      delete process.env.USERNAME
    } else {
      process.env.USERNAME = originalUsername
    }
  })

  it('reads config-scoped Claude Code 2.1 credentials before legacy credentials', async () => {
    const scopedService = serviceForConfigDir(configDir)
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
      invokeExecFileCallback(callback, null, '{"claudeAiOauth":{"accessToken":"scoped"}}\n', '')
      return null as never
    })

    await expect(readActiveClaudeKeychainCredentials(configDir)).resolves.toBe(
      '{"claudeAiOauth":{"accessToken":"scoped"}}'
    )

    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(execFileMock.mock.calls[0][1]).toEqual([
      'find-generic-password',
      '-s',
      scopedService,
      '-a',
      TEST_USER,
      '-w'
    ])
  })

  it('falls back to the legacy unsuffixed Claude Code credentials service', async () => {
    const notFound = Object.assign(new Error('not found'), { code: 44 })
    execFileMock
      .mockImplementationOnce((_file, _args, _options, callback) => {
        invokeExecFileCallback(callback, notFound, '', 'could not be found')
        return null as never
      })
      .mockImplementationOnce((_file, _args, _options, callback) => {
        invokeExecFileCallback(callback, null, 'legacy\n', '')
        return null as never
      })

    await expect(readActiveClaudeKeychainCredentials(configDir)).resolves.toBe('legacy')

    expect(execFileMock.mock.calls[1][1]).toEqual([
      'find-generic-password',
      '-s',
      'Claude Code-credentials',
      '-a',
      TEST_USER,
      '-w'
    ])
  })

  it('strictly reads only the requested active credentials service', async () => {
    const scopedService = serviceForConfigDir(configDir)
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
      invokeExecFileCallback(callback, null, 'scoped\n', '')
      return null as never
    })

    await expect(readActiveClaudeKeychainCredentialsStrict(configDir)).resolves.toBe('scoped')

    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(execFileMock.mock.calls[0][1]).toEqual([
      'find-generic-password',
      '-s',
      scopedService,
      '-a',
      TEST_USER,
      '-w'
    ])
  })

  it('rejects when a keychain read never reports completion', async () => {
    vi.useFakeTimers()
    const killMock = vi.fn()
    execFileMock.mockImplementationOnce(() => ({ kill: killMock }) as never)

    let settled = false
    let rejected: unknown
    const readPromise = readActiveClaudeKeychainCredentialsStrict(configDir).then(
      (credentials) => {
        settled = true
        return credentials
      },
      (error: unknown) => {
        settled = true
        rejected = error
        return null
      }
    )

    await vi.advanceTimersByTimeAsync(3000)

    expect(settled).toBe(true)
    await readPromise
    expect(rejected).toEqual(
      expect.objectContaining({ message: 'security timed out after 3000ms' })
    )
    expect(killMock).toHaveBeenCalled()
  })

  it('looks up claude-code-user when $USER contains @ (#12857)', async () => {
    process.env.USER = SSO_USER
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
      invokeExecFileCallback(callback, null, '{"claudeAiOauth":{"accessToken":"ok"}}\n', '')
      return null as never
    })

    await expect(readActiveClaudeKeychainCredentials()).resolves.toBe(
      '{"claudeAiOauth":{"accessToken":"ok"}}'
    )
    expect(execFileMock.mock.calls[0][1]).toEqual([
      'find-generic-password',
      '-s',
      'Claude Code-credentials',
      '-a',
      'claude-code-user',
      '-w'
    ])
  })

  it('exports no Keychain write or delete: NASH never writes Claude credentials', () => {
    expect(Object.keys(keychain).filter((name) => /write|delete/i.test(name))).toEqual([])
  })
})

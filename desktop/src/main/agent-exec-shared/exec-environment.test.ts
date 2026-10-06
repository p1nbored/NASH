import { describe, expect, it } from 'vitest'
import { buildAgentExecEnvironment } from './exec-environment'

// FIXTURE_ONLY: every value below is obviously fake.
const WIN_PARENT = {
  SystemRoot: 'C:\\Windows',
  windir: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\fixture',
  HOMEDRIVE: 'C:',
  HOMEPATH: '\\Users\\fixture',
  LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local',
  APPDATA: 'C:\\Users\\fixture\\AppData\\Roaming',
  Path: 'C:\\Windows;relative\\bin;\\\\server\\share;C:\\work\\wt\\tools;C:\\tools',
  OPENAI_API_KEY: 'FIXTURE_ONLY_openai',
  GEMINI_API_KEY: 'FIXTURE_ONLY_gemini',
  PRIVATE_HOME: 'C:\\Users\\fixture\\.private',
  RANDOM_NAME: 'kept out'
}

const POSIX_PARENT = {
  HOME: '/home/fixture',
  PATH: '/usr/bin:relative/bin:/work/wt/tools:/opt/tools',
  TMPDIR: '/tmp',
  SECRET_TOKEN: 'FIXTURE_ONLY_token'
}

describe('buildAgentExecEnvironment', () => {
  it('copies only the allowlisted names on Windows and sets a run-local temp', () => {
    const env = buildAgentExecEnvironment({
      parentEnv: WIN_PARENT,
      runTempDir: 'C:\\runs\\r1\\tmp',
      platform: 'win32',
      excludePathUnder: ['C:\\work\\wt']
    })
    expect(Object.keys(env).sort()).toEqual(
      [
        'APPDATA',
        'HOMEDRIVE',
        'HOMEPATH',
        'LOCALAPPDATA',
        'NoDefaultCurrentDirectoryInExePath',
        'PATH',
        'SystemRoot',
        'TEMP',
        'TMP',
        'USERPROFILE',
        'windir'
      ].sort()
    )
    expect(env.TEMP).toBe('C:\\runs\\r1\\tmp')
    expect(env.TMP).toBe('C:\\runs\\r1\\tmp')
    expect(env.NoDefaultCurrentDirectoryInExePath).toBe('1')
    expect(env.PATH).toBe('C:\\Windows;C:\\tools')
  })

  it('copies only HOME and sets TMPDIR on POSIX', () => {
    const env = buildAgentExecEnvironment({
      parentEnv: POSIX_PARENT,
      runTempDir: '/runs/r1/tmp',
      platform: 'linux',
      excludePathUnder: ['/work/wt']
    })
    expect(env).toEqual({
      HOME: '/home/fixture',
      PATH: '/usr/bin:/opt/tools',
      TMPDIR: '/runs/r1/tmp'
    })
  })

  it('copies no directory-valued variable unless the caller names it', () => {
    const parent = {
      ...POSIX_PARENT,
      CODEX_HOME: '/home/fixture/.codex',
      PRIVATE_HOME: '/home/fixture/.private'
    }
    const bare = buildAgentExecEnvironment({
      parentEnv: parent,
      runTempDir: '/runs/r1/tmp',
      platform: 'linux'
    })
    expect(Object.keys(bare)).not.toContain('CODEX_HOME')
    expect(Object.keys(bare)).not.toContain('PRIVATE_HOME')
    const named = buildAgentExecEnvironment({
      parentEnv: parent,
      runTempDir: '/runs/r1/tmp',
      platform: 'linux',
      passthroughDirectoryNames: ['PRIVATE_HOME']
    })
    expect(named.PRIVATE_HOME).toBe('/home/fixture/.private')
    expect(Object.keys(named)).not.toContain('CODEX_HOME')
  })

  it.each([
    ['a relative directory', 'private'],
    ['a directory inside an excluded subtree', '/work/wt/.private'],
    ['a UNC path', '\\\\server\\share\\private'],
    ['an empty value', '']
  ])('drops a passthrough directory that is %s', (_label, value) => {
    const env = buildAgentExecEnvironment({
      parentEnv: { ...POSIX_PARENT, PRIVATE_HOME: value },
      runTempDir: '/runs/r1/tmp',
      platform: 'linux',
      excludePathUnder: ['/work/wt'],
      passthroughDirectoryNames: ['PRIVATE_HOME']
    })
    expect(Object.keys(env)).not.toContain('PRIVATE_HOME')
  })

  it('refuses a relative run temp directory', () => {
    expect(() =>
      buildAgentExecEnvironment({ parentEnv: POSIX_PARENT, runTempDir: 'tmp', platform: 'linux' })
    ).toThrow(/absolute local path/)
  })

  it('sets ELECTRON_RUN_AS_NODE only when the launch target is the Electron binary', () => {
    const base = { parentEnv: POSIX_PARENT, runTempDir: '/runs/r1/tmp', platform: 'linux' } as const
    expect(buildAgentExecEnvironment(base)).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(
      buildAgentExecEnvironment({ ...base, electronRunAsNode: true }).ELECTRON_RUN_AS_NODE
    ).toBe('1')
  })

  it('throws rather than hand a secret-named variable to a child, even when the caller allowlists it', () => {
    expect(() =>
      buildAgentExecEnvironment({
        parentEnv: { ...POSIX_PARENT, MY_SERVICE_TOKEN: '/home/fixture/token-dir' },
        runTempDir: '/runs/r1/tmp',
        platform: 'linux',
        passthroughDirectoryNames: ['MY_SERVICE_TOKEN']
      })
    ).toThrow(/secret-like names/)
  })
})

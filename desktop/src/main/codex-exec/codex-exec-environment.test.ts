import { describe, expect, it } from 'vitest'
import {
  buildCodexExecEnvironment,
  isSecretLikeEnvName,
  sanitizePathList
} from './codex-exec-environment'

// FIXTURE_ONLY: every credential-looking value below is obviously fake.
const FAKE_SECRET = 'FIXTURE_ONLY_not_a_real_secret'

const HOSTILE_NAMES = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'CODEX_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDECODE',
  'GEMINI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_API_KEY',
  'AGY_CLI_TOKEN',
  'AGY_CLI_HOME',
  'AUTOPILOT_CLEF_API_KEY',
  'AUTOPILOT_CLEF_ACCOUNT_ID',
  'GITHUB_TOKEN',
  'MY_SERVICE_SECRET',
  'SOME_SERVICE_KEY',
  'some_lower_token'
]

const WIN_PARENT: NodeJS.ProcessEnv = {
  SystemRoot: 'C:\\Windows',
  windir: 'C:\\Windows',
  Path: 'C:\\Windows\\System32;relative\\bin;;"C:\\Program Files\\nodejs";C:\\work\\wt\\node_modules\\.bin;c:\\windows\\system32;.',
  USERPROFILE: 'C:\\Users\\tester',
  HOMEDRIVE: 'C:',
  HOMEPATH: '\\Users\\tester',
  LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
  APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
  CODEX_HOME: 'C:\\Users\\tester\\.codex',
  TEMP: 'C:\\Users\\tester\\AppData\\Local\\Temp',
  TMP: 'C:\\Users\\tester\\AppData\\Local\\Temp',
  NODE_OPTIONS: '--import=file:///C:/guard.mjs',
  FOO: 'bar',
  ...Object.fromEntries(HOSTILE_NAMES.map((name) => [name, FAKE_SECRET]))
}

describe('buildCodexExecEnvironment (win32)', () => {
  const build = (parentEnv: NodeJS.ProcessEnv = WIN_PARENT) =>
    buildCodexExecEnvironment({
      parentEnv,
      runTempDir: 'C:\\runs\\r1\\tmp',
      platform: 'win32',
      excludePathUnder: ['C:\\work\\wt']
    })

  it('passes exactly the allowlist with a run-local TEMP and TMP', () => {
    const env = build()
    expect(Object.keys(env).sort()).toEqual(
      [
        'APPDATA',
        'CODEX_HOME',
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
    expect(env.CODEX_HOME).toBe('C:\\Users\\tester\\.codex')
  })

  it('stops Windows from searching the working directory for executables', () => {
    expect(build().NoDefaultCurrentDirectoryInExePath).toBe('1')
  })

  it('sanitizes PATH: drops relative, empty, duplicate and worktree entries and unquotes', () => {
    expect(build().PATH).toBe('C:\\Windows\\System32;C:\\Program Files\\nodejs')
  })

  it('never carries a secret-like or unlisted variable, whatever its value', () => {
    const env = build()
    for (const name of [...HOSTILE_NAMES, 'NODE_OPTIONS', 'FOO']) {
      expect(env).not.toHaveProperty(name)
    }
    expect(Object.values(env)).not.toContain(FAKE_SECRET)
  })

  it('reads names case-insensitively and emits canonical names', () => {
    const env = buildCodexExecEnvironment({
      parentEnv: { SYSTEMROOT: 'C:\\Windows', path: 'C:\\Windows', userprofile: 'C:\\U' },
      runTempDir: 'C:\\t',
      platform: 'win32'
    })
    expect(env.SystemRoot).toBe('C:\\Windows')
    expect(env.PATH).toBe('C:\\Windows')
    expect(env.USERPROFILE).toBe('C:\\U')
  })

  it('omits CODEX_HOME when unset or empty and never reads it from anywhere else', () => {
    expect(build({ ...WIN_PARENT, CODEX_HOME: undefined })).not.toHaveProperty('CODEX_HOME')
    expect(build({ ...WIN_PARENT, CODEX_HOME: '' })).not.toHaveProperty('CODEX_HOME')
  })

  it.each([
    ['relative', 'relative\\codex-home'],
    ['a UNC share', '\\\\server\\share\\codex'],
    ['inside the worktree', 'C:\\work\\wt\\.codex'],
    ['the worktree itself', 'C:\\Work\\WT'],
    ['containing NUL', 'C:\\Users\\tester\\.codex\u0000x']
  ])('drops a CODEX_HOME that is %s, so the CLI falls back to its own default', (_label, value) => {
    expect(build({ ...WIN_PARENT, CODEX_HOME: value })).not.toHaveProperty('CODEX_HOME')
  })

  it('adds ELECTRON_RUN_AS_NODE only when the launch target is the Electron binary', () => {
    const withFlag = buildCodexExecEnvironment({
      parentEnv: WIN_PARENT,
      runTempDir: 'C:\\runs\\r1\\tmp',
      platform: 'win32',
      electronRunAsNode: true
    })
    expect(withFlag.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(build()).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  })

  it('does not mutate the parent environment', () => {
    const frozen = Object.freeze({ ...WIN_PARENT })
    expect(() => build(frozen)).not.toThrow()
  })

  it('requires an absolute run-local temp directory', () => {
    expect(() =>
      buildCodexExecEnvironment({
        parentEnv: WIN_PARENT,
        runTempDir: 'relative\\tmp',
        platform: 'win32'
      })
    ).toThrow(/absolute/)
  })
})

describe('buildCodexExecEnvironment (posix)', () => {
  const parentEnv: NodeJS.ProcessEnv = {
    HOME: '/home/tester',
    PATH: '/usr/bin:rel/bin:/bin:/usr/bin::/srv/wt/.bin',
    TMPDIR: '/tmp/parent',
    CODEX_HOME: '/home/tester/.codex',
    SystemRoot: 'C:\\Windows',
    LANG: 'en_US.UTF-8',
    ...Object.fromEntries(HOSTILE_NAMES.map((name) => [name, FAKE_SECRET]))
  }

  it('drops a relative, UNC or worktree-contained CODEX_HOME on posix too', () => {
    for (const value of ['rel/home', '/srv/wt/.codex', '//server/share']) {
      const env = buildCodexExecEnvironment({
        parentEnv: { ...parentEnv, CODEX_HOME: value },
        runTempDir: '/runs/r1/tmp',
        platform: 'linux',
        excludePathUnder: ['/srv/wt']
      })
      expect(env).not.toHaveProperty('CODEX_HOME')
    }
  })

  it('passes HOME, PATH, CODEX_HOME and a run-local TMPDIR only', () => {
    const env = buildCodexExecEnvironment({
      parentEnv,
      runTempDir: '/runs/r1/tmp',
      platform: 'linux',
      excludePathUnder: ['/srv/wt']
    })
    expect(env).toEqual({
      HOME: '/home/tester',
      PATH: '/usr/bin:/bin',
      CODEX_HOME: '/home/tester/.codex',
      TMPDIR: '/runs/r1/tmp'
    })
  })
})

describe('sanitizePathList', () => {
  it('drops UNC and device entries on win32, which can reach the network', () => {
    expect(
      sanitizePathList('C:\\a;\\\\server\\share\\bin;\\\\?\\C:\\b;//host/share;C:\\c', {
        platform: 'win32'
      })
    ).toBe('C:\\a;C:\\c')
  })

  it('keeps order and drops nothing it should keep', () => {
    expect(sanitizePathList('/a:/b:/c', { platform: 'linux' })).toBe('/a:/b:/c')
  })

  it('folds case for duplicates and exclusions on win32 only', () => {
    expect(
      sanitizePathList('C:\\A;c:\\a;C:\\B\\sub', {
        platform: 'win32',
        excludePathUnder: ['c:\\b']
      })
    ).toBe('C:\\A')
    expect(sanitizePathList('/A:/a', { platform: 'linux' })).toBe('/A:/a')
  })

  it('does not treat a sibling directory with a shared prefix as under the worktree', () => {
    expect(
      sanitizePathList('/srv/wt-tools/bin:/srv/wt/bin', {
        platform: 'linux',
        excludePathUnder: ['/srv/wt']
      })
    ).toBe('/srv/wt-tools/bin')
  })

  it('returns an empty string for empty or undefined input', () => {
    expect(sanitizePathList(undefined, { platform: 'linux' })).toBe('')
    expect(sanitizePathList('', { platform: 'win32' })).toBe('')
  })
})

describe('isSecretLikeEnvName', () => {
  it.each([
    ...HOSTILE_NAMES,
    'FOO_API_KEY',
    'x_token',
    'DB_PASSWORD',
    'AWS_ACCESS_KEY_ID',
    'AWS_SESSION_TOKEN',
    'GH_PAT',
    'PAT',
    'SERVICE_AUTH',
    'DB_CREDENTIALS',
    'DB_CREDENTIAL',
    'TOKEN',
    'PASSWORD',
    'SECRET',
    'KEY'
  ])('flags %s', (name) => {
    expect(isSecretLikeEnvName(name)).toBe(true)
  })

  it.each([
    'PATH',
    'SystemRoot',
    'CODEX_HOME',
    'APPDATA',
    'TEMP',
    'HOME',
    'HOMEPATH',
    'KEYBOARD',
    'TOKENIZER',
    'AUTHOR',
    'MONKEY',
    'NoDefaultCurrentDirectoryInExePath',
    'ELECTRON_RUN_AS_NODE'
  ])('does not flag %s', (name) => {
    expect(isSecretLikeEnvName(name)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { AgyExecutableError, resolveAgyExecutable } from './agy-exec-executable'

// FIXTURE_ONLY: files are faked by name; no process starts and the disk is not read.
const AGY_WIN = 'C:\\Users\\fixture\\AppData\\Local\\agy\\bin\\agy.exe'

function deps(existing: readonly string[]) {
  return {
    isFile: (path: string) => existing.includes(path),
    realPath: (path: string) => path
  }
}

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof AgyExecutableError ? error.code : `unexpected:${String(error)}`
  }
}

describe('resolveAgyExecutable with an explicit path', () => {
  it('launches a native .exe directly, with no shim and no prefix arguments', () => {
    expect(
      resolveAgyExecutable({ agyPath: AGY_WIN }, { platform: 'win32', deps: deps([AGY_WIN]) })
    ).toEqual({
      program: AGY_WIN,
      prefixArgs: [],
      entryPath: AGY_WIN,
      requestedPath: AGY_WIN,
      launch: 'direct',
      source: 'explicit',
      electronRunAsNode: false
    })
  })

  it.each(['C:\\tools\\agy.cmd', 'C:\\tools\\agy.bat'])(
    'starts the installed launcher %s as a shell would, directly',
    (agyPath) => {
      expect(
        resolveAgyExecutable({ agyPath }, { platform: 'win32', deps: deps([agyPath]) })
      ).toMatchObject({ program: agyPath, prefixArgs: [], entryPath: agyPath, launch: 'direct' })
    }
  )

  it('runs a .ps1 launcher under PowerShell without overriding the execution policy', () => {
    const agyPath = 'C:\\tools\\agy.ps1'
    expect(
      resolveAgyExecutable(
        { agyPath },
        { env: { PATH: 'C:\\tools' }, platform: 'win32', deps: deps([agyPath]) }
      )
    ).toEqual({
      program: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      prefixArgs: ['-NoProfile', '-File', agyPath],
      entryPath: agyPath,
      requestedPath: agyPath,
      launch: 'powershell-script',
      source: 'explicit',
      electronRunAsNode: false
    })
  })

  it.each(['C:\\tools\\agy.com', 'C:\\tools\\agy.vbs', 'C:\\tools\\agy'])(
    'refuses %s on Windows, because no shell runs it as agy',
    (agyPath) => {
      expect(
        codeOf(() =>
          resolveAgyExecutable({ agyPath }, { platform: 'win32', deps: deps([agyPath]) })
        )
      ).toBe('invalid_selection')
    }
  )

  it.each([
    'agy.exe',
    '.\\agy.exe',
    '..\\agy.exe',
    '\\\\server\\share\\agy.exe',
    '\\\\?\\C:\\agy.exe',
    ''
  ])('refuses the relative, UNC or empty path %j', (agyPath) => {
    expect(
      codeOf(() => resolveAgyExecutable({ agyPath }, { platform: 'win32', deps: deps([agyPath]) }))
    ).toBe('invalid_selection')
  })

  it('refuses a path with a NUL and a non-string path', () => {
    const win = { platform: 'win32', deps: deps([]) } as const
    expect(codeOf(() => resolveAgyExecutable({ agyPath: 'C:\\a\u0000.exe' }, win))).toBe(
      'invalid_selection'
    )
    // @ts-expect-error FIXTURE_ONLY: untyped config reaches the resolver.
    expect(codeOf(() => resolveAgyExecutable({ agyPath: 5 }, win))).toBe('invalid_selection')
  })

  it('reports a missing file as not_found', () => {
    expect(
      codeOf(() =>
        resolveAgyExecutable({ agyPath: AGY_WIN }, { platform: 'win32', deps: deps([]) })
      )
    ).toBe('not_found')
  })

  it('accepts an absolute extensionless binary on POSIX and hashes the real file behind a link', () => {
    const resolved = resolveAgyExecutable(
      { agyPath: '/home/fixture/.local/bin/agy' },
      {
        platform: 'linux',
        deps: { isFile: () => true, realPath: () => '/opt/agy/1.2.14/agy' }
      }
    )
    expect(resolved).toMatchObject({
      program: '/home/fixture/.local/bin/agy',
      entryPath: '/opt/agy/1.2.14/agy',
      launch: 'direct'
    })
  })
})

describe('resolveAgyExecutable searching PATH', () => {
  const env = { PATH: 'C:\\Windows;C:\\Users\\fixture\\AppData\\Local\\agy\\bin;C:\\later' }

  it('finds agy.exe on the first PATH entry that holds it', () => {
    const resolved = resolveAgyExecutable(
      {},
      { env, platform: 'win32', deps: deps([AGY_WIN, 'C:\\later\\agy.exe']) }
    )
    expect(resolved).toMatchObject({ program: AGY_WIN, source: 'path-search', launch: 'direct' })
  })

  it('takes the first launcher on PATH when agy.exe is absent, as a shell would', () => {
    expect(
      resolveAgyExecutable(
        {},
        { env, platform: 'win32', deps: deps(['C:\\Windows\\agy.cmd', 'C:\\later\\agy.ps1']) }
      )
    ).toMatchObject({ program: 'C:\\Windows\\agy.cmd', launch: 'direct' })
    expect(
      resolveAgyExecutable({}, { env, platform: 'win32', deps: deps(['C:\\later\\agy.ps1']) })
    ).toMatchObject({
      prefixArgs: ['-NoProfile', '-File', 'C:\\later\\agy.ps1'],
      launch: 'powershell-script',
      source: 'path-search'
    })
  })

  it('prefers agy.exe over a launcher in the same directory', () => {
    expect(
      resolveAgyExecutable(
        {},
        {
          env: { PATH: 'C:\\later' },
          platform: 'win32',
          deps: deps(['C:\\later\\agy.cmd', 'C:\\later\\agy.exe'])
        }
      ).program
    ).toBe('C:\\later\\agy.exe')
  })

  it('ignores relative, UNC and excluded entries, so a repository cannot supply the binary', () => {
    const hostile = {
      PATH: [
        '.',
        'bin',
        '\\\\server\\share',
        'C:\\work\\wt\\tools',
        'C:\\runs\\r1',
        'C:\\good'
      ].join(';')
    }
    const planted = [
      '.\\agy.exe',
      'bin\\agy.exe',
      '\\\\server\\share\\agy.exe',
      'C:\\work\\wt\\tools\\agy.exe',
      'C:\\runs\\r1\\agy.exe'
    ]
    expect(
      codeOf(() =>
        resolveAgyExecutable(
          {},
          {
            env: hostile,
            platform: 'win32',
            excludePathUnder: ['C:\\work\\wt', 'C:\\runs\\r1'],
            deps: deps(planted)
          }
        )
      )
    ).toBe('not_found')
    expect(
      resolveAgyExecutable(
        {},
        {
          env: hostile,
          platform: 'win32',
          excludePathUnder: ['C:\\work\\wt', 'C:\\runs\\r1'],
          deps: deps([...planted, 'C:\\good\\agy.exe'])
        }
      ).program
    ).toBe('C:\\good\\agy.exe')
  })

  it('reads a differently cased Path variable on Windows', () => {
    const resolved = resolveAgyExecutable(
      {},
      {
        env: { Path: 'C:\\Users\\fixture\\AppData\\Local\\agy\\bin' },
        platform: 'win32',
        deps: deps([AGY_WIN])
      }
    )
    expect(resolved.program).toBe(AGY_WIN)
  })

  it('searches for the bare name on POSIX', () => {
    const resolved = resolveAgyExecutable(
      {},
      {
        env: { PATH: '/usr/bin:/home/fixture/.local/bin' },
        platform: 'linux',
        deps: deps(['/home/fixture/.local/bin/agy'])
      }
    )
    expect(resolved.program).toBe('/home/fixture/.local/bin/agy')
  })

  it('reports not_found when PATH is empty or absent', () => {
    expect(
      codeOf(() => resolveAgyExecutable({}, { env: {}, platform: 'win32', deps: deps([]) }))
    ).toBe('not_found')
    expect(
      codeOf(() =>
        resolveAgyExecutable({}, { env: { PATH: '' }, platform: 'linux', deps: deps([]) })
      )
    ).toBe('not_found')
  })
})

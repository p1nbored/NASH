import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CodexExecutableError,
  resolveCodexExecutable,
  type CodexExecutableDeps
} from './codex-exec-executable'

const NODE_EXE = 'C:\\node\\node.exe'
const CODEX_JS = 'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'

function winDeps(
  files: readonly string[],
  shim: ReturnType<CodexExecutableDeps['resolveShim']> = {
    program: NODE_EXE,
    prefixArgs: [CODEX_JS]
  }
): { deps: CodexExecutableDeps; shimCalls: string[] } {
  const known = new Set(files.map((file) => file.toLowerCase()))
  const shimCalls: string[] = []
  return {
    shimCalls,
    deps: {
      isFile: (path) => known.has(path.toLowerCase()),
      realPath: (path) => path,
      resolveShim: (program) => {
        shimCalls.push(program)
        return shim
      }
    }
  }
}

function errorCodeOf(run: () => unknown): string | null {
  try {
    run()
  } catch (error) {
    return error instanceof CodexExecutableError ? error.code : `other:${String(error)}`
  }
  return null
}

const WIN_ENV = { PATH: 'C:\\npm;C:\\other;relative\\dir' }

describe('resolveCodexExecutable on win32', () => {
  it('resolves the npm shim to the package node entry under node.exe, never to cmd.exe', () => {
    const { deps, shimCalls } = winDeps(['C:\\npm\\codex.cmd', CODEX_JS, NODE_EXE])
    const executable = resolveCodexExecutable(
      { kind: 'installed' },
      { env: WIN_ENV, platform: 'win32', deps }
    )
    expect(executable).toEqual({
      program: NODE_EXE,
      prefixArgs: [CODEX_JS],
      entryPath: CODEX_JS,
      requestedPath: 'C:\\npm\\codex.cmd',
      launch: 'node-entry',
      source: 'path-search',
      electronRunAsNode: false
    })
    expect(shimCalls).toEqual(['C:\\npm\\codex.cmd'])
    expect(executable.program.toLowerCase()).not.toContain('cmd')
  })

  it('prefers codex.exe over codex.cmd in the same directory and launches it directly', () => {
    const { deps, shimCalls } = winDeps(['C:\\npm\\codex.cmd', 'C:\\npm\\codex.exe'])
    const executable = resolveCodexExecutable(
      { kind: 'installed' },
      { env: WIN_ENV, platform: 'win32', deps }
    )
    expect(executable).toMatchObject({
      program: 'C:\\npm\\codex.exe',
      prefixArgs: [],
      entryPath: 'C:\\npm\\codex.exe',
      launch: 'direct'
    })
    expect(shimCalls).toEqual([])
  })

  it('searches directories in PATH order and ignores relative entries', () => {
    const { deps } = winDeps(['C:\\other\\codex.cmd', 'relative\\dir\\codex.cmd'])
    expect(
      resolveCodexExecutable({ kind: 'installed' }, { env: WIN_ENV, platform: 'win32', deps })
        .requestedPath
    ).toBe('C:\\other\\codex.cmd')
  })

  it('never picks the extensionless sh shim', () => {
    const { deps } = winDeps(['C:\\npm\\codex'])
    expect(
      errorCodeOf(() =>
        resolveCodexExecutable({ kind: 'installed' }, { env: WIN_ENV, platform: 'win32', deps })
      )
    ).toBe('not_found')
  })

  it('runs a codex.ps1 launcher under Windows PowerShell when pwsh is not on PATH', () => {
    const { deps, shimCalls } = winDeps(['C:\\npm\\codex', 'C:\\npm\\codex.ps1'])
    const executable = resolveCodexExecutable(
      { kind: 'installed' },
      { env: WIN_ENV, platform: 'win32', deps }
    )
    expect(executable).toEqual({
      program: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      prefixArgs: ['-NoProfile', '-File', 'C:\\npm\\codex.ps1'],
      entryPath: 'C:\\npm\\codex.ps1',
      requestedPath: 'C:\\npm\\codex.ps1',
      launch: 'powershell-script',
      source: 'path-search',
      electronRunAsNode: false
    })
    expect(shimCalls).toEqual([])
  })

  it('prefers pwsh.exe on PATH for a .ps1 launcher', () => {
    const { deps } = winDeps(['C:\\npm\\codex.ps1', 'C:\\other\\pwsh.exe'])
    expect(
      resolveCodexExecutable({ kind: 'installed' }, { env: WIN_ENV, platform: 'win32', deps })
    ).toMatchObject({
      program: 'C:\\other\\pwsh.exe',
      prefixArgs: ['-NoProfile', '-File', 'C:\\npm\\codex.ps1'],
      launch: 'powershell-script'
    })
  })

  it('skips a codex.exe inside the packaged desktop app directory', () => {
    const { deps } = winDeps([
      'C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_1\\app\\codex.exe',
      'C:\\other\\codex.exe'
    ])
    const executable = resolveCodexExecutable(
      { kind: 'installed' },
      {
        env: { PATH: 'C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_1\\app;C:\\other' },
        platform: 'win32',
        deps
      }
    )
    expect(executable.program).toBe('C:\\other\\codex.exe')
  })

  const CMD_AS_INSTALLED = {
    program: 'C:\\npm\\codex.cmd',
    prefixArgs: [],
    entryPath: 'C:\\npm\\codex.cmd',
    requestedPath: 'C:\\npm\\codex.cmd',
    launch: 'direct',
    source: 'path-search',
    electronRunAsNode: false
  }

  it('starts a .cmd launcher it does not recognise as installed', () => {
    const { deps } = winDeps(['C:\\npm\\codex.cmd'], null)
    expect(
      resolveCodexExecutable({ kind: 'installed' }, { env: WIN_ENV, platform: 'win32', deps })
    ).toEqual(CMD_AS_INSTALLED)
  })

  it('starts a .cmd launcher that sets its own environment as installed', () => {
    const { deps } = winDeps(['C:\\npm\\codex.cmd'], {
      program: NODE_EXE,
      prefixArgs: [CODEX_JS],
      env: { NODE_PATH: 'C:\\store' }
    })
    expect(
      resolveCodexExecutable({ kind: 'installed' }, { env: WIN_ENV, platform: 'win32', deps })
    ).toEqual(CMD_AS_INSTALLED)
  })

  it('accepts an explicit absolute shim path and rejects relative or missing ones', () => {
    const { deps } = winDeps(['D:\\tools\\codex.cmd'])
    expect(
      resolveCodexExecutable(
        { kind: 'installed', codexPath: 'D:\\tools\\codex.cmd' },
        { env: WIN_ENV, platform: 'win32', deps }
      )
    ).toMatchObject({
      source: 'explicit',
      requestedPath: 'D:\\tools\\codex.cmd',
      launch: 'node-entry'
    })
    expect(
      errorCodeOf(() =>
        resolveCodexExecutable(
          { kind: 'installed', codexPath: 'tools\\codex.cmd' },
          { env: WIN_ENV, platform: 'win32', deps }
        )
      )
    ).toBe('invalid_selection')
    expect(
      errorCodeOf(() =>
        resolveCodexExecutable(
          { kind: 'installed', codexPath: 'D:\\gone\\codex.cmd' },
          { env: WIN_ENV, platform: 'win32', deps }
        )
      )
    ).toBe('not_found')
  })

  it('accepts an explicit .bat or .ps1 launcher', () => {
    const { deps } = winDeps(['D:\\tools\\codex.ps1', 'D:\\tools\\codex.bat'])
    const options = { env: WIN_ENV, platform: 'win32' as const, deps }
    expect(
      resolveCodexExecutable({ kind: 'installed', codexPath: 'D:\\tools\\codex.bat' }, options)
    ).toMatchObject({ program: 'D:\\tools\\codex.bat', prefixArgs: [], launch: 'direct' })
    expect(
      resolveCodexExecutable({ kind: 'installed', codexPath: 'D:\\tools\\codex.ps1' }, options)
    ).toMatchObject({
      prefixArgs: ['-NoProfile', '-File', 'D:\\tools\\codex.ps1'],
      launch: 'powershell-script',
      source: 'explicit'
    })
  })

  it('rejects an explicit path that is not a launcher a shell would run', () => {
    const { deps } = winDeps(['D:\\tools\\codex.vbs', 'D:\\tools\\codex'])
    for (const codexPath of ['D:\\tools\\codex.vbs', 'D:\\tools\\codex']) {
      expect(
        errorCodeOf(() =>
          resolveCodexExecutable(
            { kind: 'installed', codexPath },
            { env: WIN_ENV, platform: 'win32', deps }
          )
        )
      ).toBe('invalid_selection')
    }
  })
})

describe('resolveCodexExecutable on posix', () => {
  const posixDeps = (files: readonly string[], real: Record<string, string> = {}) => ({
    isFile: (path: string) => files.includes(path),
    realPath: (path: string) => real[path] ?? path,
    resolveShim: () => null
  })

  it('launches the found codex directly and hashes the real file behind a symlink', () => {
    const executable = resolveCodexExecutable(
      { kind: 'installed' },
      {
        env: { PATH: '/nope:/usr/local/bin:/usr/bin' },
        platform: 'linux',
        deps: posixDeps(['/usr/local/bin/codex'], {
          '/usr/local/bin/codex': '/usr/local/lib/node_modules/@openai/codex/bin/codex.js'
        })
      }
    )
    expect(executable).toEqual({
      program: '/usr/local/bin/codex',
      prefixArgs: [],
      entryPath: '/usr/local/lib/node_modules/@openai/codex/bin/codex.js',
      requestedPath: '/usr/local/bin/codex',
      launch: 'direct',
      source: 'path-search',
      electronRunAsNode: false
    })
  })

  it('reports not_found when PATH has no codex', () => {
    expect(
      errorCodeOf(() =>
        resolveCodexExecutable(
          { kind: 'installed' },
          { env: { PATH: '/usr/bin' }, platform: 'linux', deps: posixDeps([]) }
        )
      )
    ).toBe('not_found')
  })
})

describe('resolveCodexExecutable node-entry selection', () => {
  it('runs the entry under the given node and requires an absolute existing file', () => {
    const entry = join(__dirname, 'codex-exec-executable.test.ts')
    const executable = resolveCodexExecutable({ kind: 'node-entry', entryPath: entry })
    expect(executable).toEqual({
      program: process.execPath,
      prefixArgs: [entry],
      entryPath: entry,
      requestedPath: entry,
      launch: 'node-entry',
      source: 'node-entry',
      electronRunAsNode: false
    })
    expect(
      errorCodeOf(() => resolveCodexExecutable({ kind: 'node-entry', entryPath: 'codex.js' }))
    ).toBe('invalid_selection')
    expect(
      errorCodeOf(() =>
        resolveCodexExecutable({
          kind: 'node-entry',
          entryPath: join(__dirname, 'does-not-exist.js')
        })
      )
    ).toBe('not_found')
  })

  it('accepts an explicit node path', () => {
    const entry = join(__dirname, 'codex-exec-executable.test.ts')
    expect(
      resolveCodexExecutable({ kind: 'node-entry', entryPath: entry, nodePath: process.execPath })
        .program
    ).toBe(process.execPath)
  })

  it.each([
    ['relative', 'bin/node'],
    ['a batch file', join(__dirname, 'x.bat')],
    ['a command script', join(__dirname, 'x.cmd')],
    ['a com file', join(__dirname, 'x.com')],
    ['a UNC path', '\\\\server\\share\\node.exe']
  ])('refuses an explicit node path that is %s', (_label, nodePath) => {
    const entry = join(__dirname, 'codex-exec-executable.test.ts')
    expect(
      errorCodeOf(() => resolveCodexExecutable({ kind: 'node-entry', entryPath: entry, nodePath }))
    ).toBe('invalid_selection')
  })

  it('refuses an explicit node path that does not exist', () => {
    const entry = join(__dirname, 'codex-exec-executable.test.ts')
    expect(
      errorCodeOf(() =>
        resolveCodexExecutable({
          kind: 'node-entry',
          entryPath: entry,
          nodePath: join(__dirname, 'no-such-node.exe')
        })
      )
    ).toBe('not_found')
  })
})

describe('resolveCodexExecutable under Electron', () => {
  const entry = join(__dirname, 'codex-exec-executable.test.ts')
  const electron = { isElectron: true, execPath: process.execPath }

  it('runs the entry through the app binary as Node, as the rest of Orca does', () => {
    const executable = resolveCodexExecutable({ kind: 'node-entry', entryPath: entry }, electron)
    expect(executable).toMatchObject({
      program: process.execPath,
      prefixArgs: [entry],
      electronRunAsNode: true
    })
  })

  it('prefers an explicit node path, which needs no environment switch', () => {
    const executable = resolveCodexExecutable(
      { kind: 'node-entry', entryPath: entry, nodePath: process.execPath },
      electron
    )
    expect(executable.electronRunAsNode).toBe(false)
  })

  it('applies to a .js file found through an explicit installed path too', () => {
    const { deps } = winDeps(['D:\\tools\\codex.js'])
    const executable = resolveCodexExecutable(
      { kind: 'installed', codexPath: 'D:\\tools\\codex.js' },
      { env: WIN_ENV, platform: 'win32', deps, isElectron: true, execPath: 'C:\\Orca\\Orca.exe' }
    )
    expect(executable).toMatchObject({
      program: 'C:\\Orca\\Orca.exe',
      prefixArgs: ['D:\\tools\\codex.js'],
      electronRunAsNode: true
    })
  })

  it('never marks a native binary as needing the switch', () => {
    const { deps } = winDeps(['D:\\tools\\codex.exe'])
    const executable = resolveCodexExecutable(
      { kind: 'installed', codexPath: 'D:\\tools\\codex.exe' },
      { env: WIN_ENV, platform: 'win32', deps, isElectron: true, execPath: 'C:\\Orca\\Orca.exe' }
    )
    expect(executable.electronRunAsNode).toBe(false)
  })
})

describe('resolveCodexExecutable PATH hygiene', () => {
  const env = { PATH: 'C:\\work\\wt\\bin;\\\\server\\share\\bin;relative\\bin;C:\\npm' }

  it('does not find a codex planted in the worktree or on a network share', () => {
    const { deps } = winDeps([
      'C:\\work\\wt\\bin\\codex.exe',
      '\\\\server\\share\\bin\\codex.exe',
      'C:\\npm\\codex.exe'
    ])
    const executable = resolveCodexExecutable(
      { kind: 'installed' },
      { env, platform: 'win32', deps, excludePathUnder: ['C:\\work\\wt'] }
    )
    expect(executable.program).toBe('C:\\npm\\codex.exe')
  })

  it('hands the shim resolver a PATH with the same entries removed', () => {
    const seen: string[] = []
    const files = ['C:\\work\\wt\\bin\\codex.cmd', 'C:\\npm\\codex.cmd']
    const known = new Set(files.map((file) => file.toLowerCase()))
    const deps = {
      isFile: (path: string) => known.has(path.toLowerCase()),
      realPath: (path: string) => path,
      resolveShim: (_program: string, shimEnv: NodeJS.ProcessEnv) => {
        seen.push(shimEnv.PATH ?? '')
        return { program: NODE_EXE, prefixArgs: [CODEX_JS] }
      }
    }
    resolveCodexExecutable(
      { kind: 'installed' },
      { env, platform: 'win32', deps, excludePathUnder: ['C:\\work\\wt'] }
    )
    expect(seen).toEqual(['C:\\npm'])
  })
})

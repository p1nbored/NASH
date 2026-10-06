import { describe, expect, it } from 'vitest'
import type { LaunchTarget } from './launch-target'
import { findExecutableProblem, type ExecutableCheckContext } from './executable-validation'

const WIN: ExecutableCheckContext = {
  worktreePath: 'C:\\work\\wt',
  runDir: 'C:\\runs\\r1',
  platform: 'win32',
  electron: { isElectron: false, execPath: 'C:\\Orca\\Orca.exe' },
  realPath: (path) => path
}

const POSIX: ExecutableCheckContext = {
  worktreePath: '/srv/wt',
  runDir: '/runs/r1',
  platform: 'linux',
  electron: { isElectron: false, execPath: '/opt/orca/orca' },
  realPath: (path) => path
}

function executable(overrides: Partial<LaunchTarget> = {}): LaunchTarget {
  return {
    program: 'C:\\tools\\codex.exe',
    prefixArgs: [],
    entryPath: 'C:\\tools\\codex.exe',
    requestedPath: 'C:\\tools\\codex.exe',
    launch: 'direct',
    electronRunAsNode: false,
    ...overrides
  }
}

const NODE_ENTRY = {
  program: 'C:\\node\\node.exe',
  prefixArgs: ['C:\\npm\\codex.js'],
  entryPath: 'C:\\npm\\codex.js',
  requestedPath: 'C:\\npm\\codex.cmd',
  launch: 'node-entry'
} as const

const POWERSHELL_SCRIPT = {
  program: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  prefixArgs: ['-NoProfile', '-File', 'C:\\npm\\codex.ps1'],
  entryPath: 'C:\\npm\\codex.ps1',
  requestedPath: 'C:\\npm\\codex.ps1',
  launch: 'powershell-script'
} as const

describe('findExecutableProblem', () => {
  it('accepts a native binary and a node entry launched by an absolute node', () => {
    expect(findExecutableProblem(executable(), WIN)).toBeNull()
    expect(findExecutableProblem(executable(NODE_ENTRY), WIN)).toBeNull()
  })

  // D-023 amendment: a CLI starts through whatever launcher its installation provides.
  it.each([
    ['a command script', 'C:\\tools\\codex.cmd'],
    ['a batch file', 'C:\\tools\\codex.bat'],
    ['a com file', 'C:\\tools\\codex.com'],
    ['cmd.exe', 'C:\\Windows\\System32\\CMD.EXE']
  ] as const)('accepts %s as the program', (_label, program) => {
    expect(findExecutableProblem(executable({ program, entryPath: program }), WIN)).toBeNull()
  })

  it('accepts a .ps1 launcher run by PowerShell with exactly -NoProfile -File and the script', () => {
    expect(findExecutableProblem(executable(POWERSHELL_SCRIPT), WIN)).toBeNull()
  })

  it.each([
    ['a relative program', { program: 'codex.exe' }],
    ['a program with a dot-relative path', { program: '.\\codex.exe' }],
    ['a UNC program', { program: '\\\\server\\share\\codex.exe' }],
    ['a device path', { program: '\\\\?\\C:\\tools\\codex.exe' }],
    ['a program containing NUL', { program: 'C:\\tools\\codex.exe\u0000.txt' }],
    ['a program inside the worktree', { program: 'C:\\work\\wt\\bin\\codex.exe' }],
    ['a program inside the run directory', { program: 'C:\\Runs\\R1\\tmp\\codex.exe' }],
    [
      'a node entry inside the worktree',
      { ...NODE_ENTRY, prefixArgs: ['C:\\work\\wt\\codex.js'], entryPath: 'C:\\work\\wt\\codex.js' }
    ],
    [
      'a node entry that is not the only prefix argument',
      { ...NODE_ENTRY, prefixArgs: ['-e', 'C:\\npm\\codex.js'] }
    ],
    [
      'a node entry whose prefix is not the entry',
      { ...NODE_ENTRY, prefixArgs: ['C:\\other\\x.js'] }
    ],
    ['a direct launch with prefix arguments', { prefixArgs: ['--inspect'] }],
    [
      'a PowerShell launch with an execution-policy override',
      {
        ...POWERSHELL_SCRIPT,
        prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\npm\\codex.ps1']
      }
    ],
    [
      'a PowerShell launch of a different script than the entry',
      { ...POWERSHELL_SCRIPT, prefixArgs: ['-NoProfile', '-File', 'C:\\other\\x.ps1'] }
    ],
    [
      'a PowerShell launch of a script inside the worktree',
      {
        ...POWERSHELL_SCRIPT,
        prefixArgs: ['-NoProfile', '-File', 'C:\\work\\wt\\codex.ps1'],
        entryPath: 'C:\\work\\wt\\codex.ps1'
      }
    ]
  ] as const)('refuses %s', (_label, overrides) => {
    expect(findExecutableProblem(executable(overrides), WIN)).not.toBeNull()
  })

  it('refuses a path that is a link into the worktree, judged on the real location', () => {
    const linked: ExecutableCheckContext = {
      ...WIN,
      realPath: (path) => (path === 'C:\\tools\\codex.exe' ? 'C:\\work\\wt\\payload.exe' : path)
    }
    expect(findExecutableProblem(executable(), linked)).not.toBeNull()
  })

  it('applies the same rules on posix', () => {
    const native = executable({ program: '/usr/bin/codex', entryPath: '/usr/bin/codex' })
    expect(findExecutableProblem(native, POSIX)).toBeNull()
    expect(findExecutableProblem({ ...native, program: '/srv/wt/codex' }, POSIX)).not.toBeNull()
    expect(findExecutableProblem({ ...native, program: 'codex' }, POSIX)).not.toBeNull()
  })

  it('refuses the Electron binary unless it is told to act as Node', () => {
    const electron = { isElectron: true, execPath: 'C:\\Orca\\Orca.exe' }
    const asApp = executable({ ...NODE_ENTRY, program: 'C:\\Orca\\Orca.exe' })
    expect(findExecutableProblem(asApp, { ...WIN, electron })).not.toBeNull()
    expect(
      findExecutableProblem({ ...asApp, electronRunAsNode: true }, { ...WIN, electron })
    ).toBeNull()
  })

  it('does not apply the Electron rule when this process is not Electron', () => {
    const asNode = executable({ ...NODE_ENTRY, program: 'C:\\Orca\\Orca.exe' })
    expect(findExecutableProblem(asNode, WIN)).toBeNull()
  })

  it('refuses an object that is not a launch description at all', () => {
    expect(findExecutableProblem(JSON.parse('{"program":5}'), WIN)).not.toBeNull()
    expect(findExecutableProblem(JSON.parse('null'), WIN)).not.toBeNull()
  })
})

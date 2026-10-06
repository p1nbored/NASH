import { describe, expect, it, vi } from 'vitest'
import { resolveClaudeLaunchTarget } from './autopilot-claude-launch-target'

function deps(path: string, platform: NodeJS.Platform, isFile = true) {
  return {
    resolveCommand: vi.fn(() => path),
    isFile: vi.fn(() => isFile),
    realPath: vi.fn((value: string) => `${value}.real`),
    platform
  }
}

describe('resolveClaudeLaunchTarget', () => {
  it('launches a native Windows claude.exe directly', () => {
    const target = resolveClaudeLaunchTarget(deps('C:\\fixture\\bin\\claude.exe', 'win32'))
    expect(target).toEqual({
      program: 'C:\\fixture\\bin\\claude.exe',
      prefixArgs: [],
      entryPath: 'C:\\fixture\\bin\\claude.exe.real',
      requestedPath: 'C:\\fixture\\bin\\claude.exe',
      launch: 'direct',
      electronRunAsNode: false
    })
  })

  it('starts an installed Windows .cmd launcher as a shell would', () => {
    expect(resolveClaudeLaunchTarget(deps('C:\\fixture\\npm\\claude.cmd', 'win32'))).toMatchObject({
      program: 'C:\\fixture\\npm\\claude.cmd',
      prefixArgs: [],
      launch: 'direct'
    })
  })

  it('runs a Windows .ps1 launcher under PowerShell', () => {
    const target = resolveClaudeLaunchTarget({
      ...deps('C:\\fixture\\npm\\claude.ps1', 'win32'),
      isFile: vi.fn((path: string) => path === 'C:\\fixture\\npm\\claude.ps1'),
      env: { PATH: 'C:\\fixture\\npm' }
    })
    expect(target).toEqual({
      program: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      prefixArgs: ['-NoProfile', '-File', 'C:\\fixture\\npm\\claude.ps1'],
      entryPath: 'C:\\fixture\\npm\\claude.ps1',
      requestedPath: 'C:\\fixture\\npm\\claude.ps1',
      launch: 'powershell-script',
      electronRunAsNode: false
    })
  })

  it('answers null for a Windows file no shell would run as claude', () => {
    expect(resolveClaudeLaunchTarget(deps('C:\\fixture\\npm\\claude.vbs', 'win32'))).toBeNull()
  })

  it('launches a POSIX claude binary directly', () => {
    expect(resolveClaudeLaunchTarget(deps('/fixture/bin/claude', 'linux'))?.program).toBe(
      '/fixture/bin/claude'
    )
  })

  it('answers null when claude is not installed', () => {
    // Why the bare name: the shared resolver returns the command name when it finds nothing.
    expect(resolveClaudeLaunchTarget(deps('claude', 'linux'))).toBeNull()
    expect(resolveClaudeLaunchTarget(deps('/fixture/bin/claude', 'linux', false))).toBeNull()
  })

  it('refuses a UNC path, which can reach the network', () => {
    expect(resolveClaudeLaunchTarget(deps('\\\\server\\share\\claude.exe', 'win32'))).toBeNull()
  })
})

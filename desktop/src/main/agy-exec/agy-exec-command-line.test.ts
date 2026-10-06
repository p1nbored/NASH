import { describe, expect, it } from 'vitest'
import type { LaunchTarget } from '../agent-exec-shared/launch-target'
import {
  agyCommandLineProblem,
  CMD_COMMAND_LINE_MAX_UNITS,
  measureAgyCommandLine,
  POSIX_ARGUMENT_MAX_BYTES,
  WINDOWS_COMMAND_LINE_MAX_UNITS
} from './agy-exec-command-line'

// D-027: the prompt rides argv, so the only prompt limit is what the OS can start.

function target(program: string): LaunchTarget {
  return { program, prefixArgs: [], entryPath: program, requestedPath: program, launch: 'direct' }
}

const NATIVE = target('C:\\Tools\\agy\\agy.exe')
// No such file, so shim resolution finds nothing and the launcher goes through cmd.exe.
const UNRESOLVED_SHIM = target('C:\\nash-fixture-missing\\agy.cmd')
const POSIX = target('/opt/agy/bin/agy')

function argvWith(prompt: string): readonly string[] {
  return [`--print=${prompt}`, '--sandbox', '--model', 'gemini-3.8-flash-high']
}

function problem(executable: LaunchTarget, prompt: string, platform: NodeJS.Platform) {
  return agyCommandLineProblem({ executable, argv: argvWith(prompt), platform, env: {} })
}

function fixedWindowsUnits(executable: LaunchTarget): number {
  return measureAgyCommandLine({ executable, argv: argvWith(''), platform: 'win32', env: {} }).units
}

describe('agy command-line ceiling', () => {
  it('admits a prompt that fills the Windows command line exactly, and refuses one more character', () => {
    const room = WINDOWS_COMMAND_LINE_MAX_UNITS - fixedWindowsUnits(NATIVE)
    expect(room).toBeGreaterThan(30_000)
    expect(problem(NATIVE, 'a'.repeat(room), 'win32')).toBeNull()
    expect(problem(NATIVE, 'a'.repeat(room + 1), 'win32')).toMatch(/^prompt_too_large: /)
  })

  it('counts the quoting: an embedded quote takes two characters on the line', () => {
    const room = WINDOWS_COMMAND_LINE_MAX_UNITS - fixedWindowsUnits(NATIVE)
    const half = Math.floor(room / 2)
    expect(problem(NATIVE, '"'.repeat(half), 'win32')).toBeNull()
    expect(problem(NATIVE, '"'.repeat(half + 1), 'win32')).toMatch(/^prompt_too_large: /)
  })

  it('holds a launcher that runs through cmd.exe to the cmd.exe ceiling', () => {
    const room = CMD_COMMAND_LINE_MAX_UNITS - fixedWindowsUnits(UNRESOLVED_SHIM)
    expect(
      measureAgyCommandLine({
        executable: UNRESOLVED_SHIM,
        argv: argvWith(''),
        platform: 'win32',
        env: {}
      }).viaCmd
    ).toBe(true)
    expect(problem(UNRESOLVED_SHIM, 'a'.repeat(room), 'win32')).toBeNull()
    expect(problem(UNRESOLVED_SHIM, 'a'.repeat(room + 1), 'win32')).toContain('cmd.exe')
  })

  it('holds each POSIX argument to the kernel per-argument limit, counted in UTF-8 bytes', () => {
    const room = POSIX_ARGUMENT_MAX_BYTES - '--print='.length
    expect(problem(POSIX, 'a'.repeat(room), 'linux')).toBeNull()
    expect(problem(POSIX, 'a'.repeat(room + 1), 'linux')).toMatch(/^prompt_too_large: /)
    // Two UTF-8 bytes each, so half the room in this letter is the boundary.
    expect(problem(POSIX, 'é'.repeat(Math.floor(room / 2) + 1), 'darwin')).toMatch(
      /^prompt_too_large: /
    )
  })

  it('says how long the line is and what the ceiling is, so the refusal is clear', () => {
    const detail = problem(NATIVE, 'a'.repeat(40_000), 'win32') ?? ''
    expect(detail).toContain(String(WINDOWS_COMMAND_LINE_MAX_UNITS))
    expect(detail).toMatch(/shorten/i)
  })
})

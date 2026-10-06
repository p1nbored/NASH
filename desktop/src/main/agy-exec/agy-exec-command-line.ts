import { resolveSpawn } from '../../shared/child-process/spawn-resolution'
import { quoteWindowsArgument } from '../../shared/child-process/windows-command-line'
import type { LaunchTarget } from '../agent-exec-shared/launch-target'

// D-027: the prompt rides argv, so its only limit is the command line the OS can start.

/** CreateProcess takes at most 32,767 UTF-16 units including the terminating NUL. */
export const WINDOWS_COMMAND_LINE_MAX_UNITS = 32_766
/** cmd.exe refuses a command line longer than 8,191 characters. */
export const CMD_COMMAND_LINE_MAX_UNITS = 8_191
/** Linux caps one argument at 32 pages (128 KiB) including its NUL; macOS caps the total higher. */
export const POSIX_ARGUMENT_MAX_BYTES = 128 * 1024 - 1

export type AgyCommandLineInput = {
  readonly executable: LaunchTarget
  readonly argv: readonly string[]
  readonly platform: NodeJS.Platform
  /** The environment the child gets; a .cmd shim is resolved against its PATH. */
  readonly env: NodeJS.ProcessEnv
}

export type WindowsCommandLineMeasure = {
  readonly units: number
  readonly max: number
  readonly viaCmd: boolean
}

/** The length of the line the spawn pipeline would hand CreateProcess, quoted the way it would be. */
export function measureAgyCommandLine(input: AgyCommandLineInput): WindowsCommandLineMeasure {
  const resolved = resolveSpawn(
    {
      program: input.executable.program,
      args: [...input.executable.prefixArgs, ...input.argv],
      env: input.env
    },
    'win32'
  )
  const parts = [resolved.file, ...resolved.args]
  if (resolved.options.windowsVerbatimArguments === true) {
    return { units: parts.join(' ').length, max: CMD_COMMAND_LINE_MAX_UNITS, viaCmd: true }
  }
  // quoteWindowsArgument always quotes, so this is never shorter than the line Node builds.
  const units = parts.map(quoteWindowsArgument).join(' ').length
  return { units, max: WINDOWS_COMMAND_LINE_MAX_UNITS, viaCmd: false }
}

function windowsProblem(input: AgyCommandLineInput): string | null {
  let measured: WindowsCommandLineMeasure
  try {
    measured = measureAgyCommandLine(input)
  } catch {
    // Only the cmd.exe path throws (a line break in an argument); the spawn reports that itself.
    return null
  }
  if (measured.units <= measured.max) {
    return null
  }
  const through = measured.viaCmd ? ' through cmd.exe' : ''
  return `prompt_too_large: the command line needs ${measured.units} characters and Windows starts at most ${measured.max}${through}; shorten the task text.`
}

function posixProblem(argv: readonly string[]): string | null {
  const longest = Math.max(0, ...argv.map((arg) => Buffer.byteLength(arg, 'utf8')))
  return longest <= POSIX_ARGUMENT_MAX_BYTES
    ? null
    : `prompt_too_large: one argument needs ${longest} bytes and the system takes at most ${POSIX_ARGUMENT_MAX_BYTES}; shorten the task text.`
}

/** The refusal detail when the OS cannot start this agy command line, or null when it can. */
export function agyCommandLineProblem(input: AgyCommandLineInput): string | null {
  return input.platform === 'win32' ? windowsProblem(input) : posixProblem(input.argv)
}

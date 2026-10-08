import { rawSegmentsOf } from './permission-path-normalization'
import {
  isSensitivePath,
  segmentsAreSensitive,
  type SensitivePathContext
} from './permission-sensitive-paths'

/**
 * Shell syntax that can build, quote, escape or expand a name the token checks below would never
 * see (security review M1): quotes, `$`, backticks, globs, `\`, braces, brackets and `~`, plus the
 * cmd.exe escape `^` and its `%var%` and `!var!` expansions. Such a command stays on the desktop.
 */
const SHELL_EXPANSION = /['"`$*?\\{}[\]~^%!]/
const COMMAND_TOKEN_SEPARATORS = /[\s;|&()<>=,]+/
const EXECUTABLE_SUFFIX = /\.(exe|com|cmd|bat|ps1|sh|js|mjs|cjs)$/
const TRAILING_DOTS_AND_SPACES = /[. ]+$/
const DRIVE_PREFIX = /^[a-z]:/i
const PARENT_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/
const CRITICAL_COMMANDS = new Set([
  'rm',
  'rmdir',
  'del',
  'erase',
  'remove-item',
  'format',
  'diskpart',
  'sudo',
  'su',
  'chmod',
  'chown',
  'icacls',
  'reg',
  'shutdown',
  'curl',
  'wget',
  'invoke-webrequest',
  'invoke-restmethod'
])

function isCriticalCommand(tokens: readonly string[]): boolean {
  const names = tokens.map(
    (token) => rawSegmentsOf(token.toLowerCase()).at(-1)?.replace(EXECUTABLE_SUFFIX, '') ?? ''
  )
  if (names.some((name) => CRITICAL_COMMANDS.has(name))) {
    return true
  }
  const git = names.indexOf('git')
  if (
    git !== -1 &&
    names.slice(git + 1).some((name) => ['push', 'reset', 'clean'].includes(name))
  ) {
    return true
  }
  return names.some((name) => ['npm', 'pnpm', 'yarn'].includes(name)) && names.includes('publish')
}

export type CommandGuardContext = SensitivePathContext & {
  /** The app's own CLI plus `claude` and `orca`, lower case. */
  readonly controlPlane: ReadonlySet<string>
}

function namesControlPlane(token: string, controlPlane: ReadonlySet<string>): boolean {
  const last = rawSegmentsOf(token).at(-1)?.replace(TRAILING_DOTS_AND_SPACES, '')
  return last !== undefined && controlPlane.has(last.replace(EXECUTABLE_SUFFIX, ''))
}

/** `a:b` is checked as `a` and `b`, so a stream name or a `ref:path` cannot hide a file name. */
function colonParts(token: string): string[] {
  const drive = DRIVE_PREFIX.exec(token)?.[0] ?? ''
  const [first = '', ...rest] = token.slice(drive.length).split(':')
  return [`${drive}${first}`, ...rest].filter((part) => part.length > 0)
}

/** Climbing out of a working directory inside `.claude/worktrees` would reach `.claude` itself. */
function climbsOutOfProtectedDirectory(parts: readonly string[], cwd: string | null): boolean {
  return (
    cwd !== null &&
    parts.some((part) => PARENT_SEGMENT.test(part)) &&
    segmentsAreSensitive(rawSegmentsOf(cwd), { exemptWorktrees: false })
  )
}

/**
 * True when a Bash, PowerShell or Monitor command must stay on the desktop: it uses shell syntax
 * that can hide a name, runs the control plane, or names a protected or credential path.
 */
export function isDesktopOnlyCommand(command: string, context: CommandGuardContext): boolean {
  if (SHELL_EXPANSION.test(command)) {
    return true
  }
  const tokens = command.split(COMMAND_TOKEN_SEPARATORS).filter((token) => token.length > 0)
  if (isCriticalCommand(tokens)) {
    return true
  }
  if (tokens.some((token) => namesControlPlane(token, context.controlPlane))) {
    return true
  }
  const parts = tokens.flatMap(colonParts)
  return (
    parts.some((part) => isSensitivePath(part, context)) ||
    climbsOutOfProtectedDirectory(parts, context.base)
  )
}

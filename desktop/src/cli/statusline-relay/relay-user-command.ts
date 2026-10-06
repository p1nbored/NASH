import { posix, win32 } from 'node:path'
import type { ClaudeStatusLineRelayRequest } from '../../shared/claude-statusline-relay-contract'
import {
  runProcess,
  type ProcessResult,
  type ProcessSpec
} from '../../shared/child-process/run-process'

/**
 * Why a short bound: Claude Code 2.1.289's local docs give no status-line timeout, and a status line
 * that has not answered in this long is stale anyway.
 */
export const USER_STATUS_LINE_TIMEOUT_MS = 5_000
export const USER_STATUS_LINE_MAX_OUTPUT_BYTES = 256 * 1024

// Why only these: Claude Code runs shell-form commands through Git Bash on Windows and sh elsewhere,
// so the relay never starts cmd.exe, PowerShell or a script launcher, whatever its argument says.
const SHELL_FILE_NAMES = new Set(['bash.exe', 'bash', 'sh.exe', 'sh'])

export type UserCommandPorts = {
  readonly env: NodeJS.ProcessEnv
  readonly cwd: string
  readonly run?: (spec: ProcessSpec) => Promise<ProcessResult>
}

/**
 * Runs the user's status-line command the way Claude Code does (`<shell> -c <command>`, the status
 * JSON on stdin) and returns its stdout bytes unchanged, or null after any failure or timeout.
 */
export async function runUserStatusLine(
  request: ClaudeStatusLineRelayRequest,
  input: string,
  ports: UserCommandPorts
): Promise<Buffer | null> {
  if (request.command === null || !isAllowedShell(request.shell)) {
    return null
  }
  const run = ports.run ?? ((spec: ProcessSpec) => runProcess(spec))
  try {
    const result = await run({
      program: request.shell,
      args: ['-c', request.command],
      cwd: ports.cwd,
      env: withoutNodeMode(ports.env),
      input,
      timeoutMs: USER_STATUS_LINE_TIMEOUT_MS,
      maxOutputBytes: USER_STATUS_LINE_MAX_OUTPUT_BYTES,
      killOnOutputLimit: true,
      captureStdoutAsBytes: true
    })
    if (result.timedOut || result.code !== 0 || result.outputTruncated || !result.stdoutBytes) {
      return null
    }
    return result.stdoutBytes
  } catch {
    return null
  }
}

function isAllowedShell(shell: string): boolean {
  const absolute = win32.isAbsolute(shell) || posix.isAbsolute(shell)
  return absolute && SHELL_FILE_NAMES.has(win32.basename(shell).toLowerCase())
}

/** The relay runs the app binary as Node; the user's command and its children must not inherit that. */
function withoutNodeMode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE')
  )
}

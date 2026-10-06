import { Buffer } from 'node:buffer'

/**
 * The contract between the `statusLine` NASH writes into a primary session's generated settings and
 * the relay script that command runs (user decision of 2026-10-06, "Primary only"). The relay
 * forwards Claude Code's `rate_limits` to NASH, then runs the user's own status line.
 */

/** Folder and file of the compiled relay inside the CLI output tree (`out/cli/...`). */
export const CLAUDE_STATUSLINE_RELAY_DIRECTORY = 'statusline-relay'
export const CLAUDE_STATUSLINE_RELAY_ENTRY_FILE = 'claude-statusline-relay.js'

/** Why a cap: the argument rides on a command line, which Windows bounds at 32,767 characters. */
export const CLAUDE_STATUSLINE_RELAY_MAX_ARGUMENT_CHARS = 8192

export type ClaudeStatusLineRelayRequest = {
  /** Absolute path of the shell Claude Code runs status-line commands in (Git Bash on Windows). */
  readonly shell: string
  /** The user's own status-line command, resolved at launch; null when none is configured. */
  readonly command: string | null
}

const REQUEST_VERSION = 1
const BASE64URL = /^[A-Za-z0-9_-]+$/

/** One base64url word, so no shell quoting or MSYS path conversion can alter it on the way. */
export function encodeClaudeStatusLineRelayRequest(request: ClaudeStatusLineRelayRequest): string {
  const json = JSON.stringify({
    v: REQUEST_VERSION,
    shell: request.shell,
    command: request.command
  })
  return Buffer.from(json, 'utf8').toString('base64url')
}

export function decodeClaudeStatusLineRelayRequest(
  argument: unknown
): ClaudeStatusLineRelayRequest | null {
  if (
    typeof argument !== 'string' ||
    argument.length === 0 ||
    argument.length > CLAUDE_STATUSLINE_RELAY_MAX_ARGUMENT_CHARS ||
    !BASE64URL.test(argument)
  ) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(argument, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || !('v' in parsed) || !('shell' in parsed)) {
    return null
  }
  if (parsed.v !== REQUEST_VERSION || typeof parsed.shell !== 'string' || parsed.shell === '') {
    return null
  }
  const raw = 'command' in parsed ? parsed.command : null
  const command = typeof raw === 'string' && raw.trim() !== '' ? raw : null
  return { shell: parsed.shell, command }
}

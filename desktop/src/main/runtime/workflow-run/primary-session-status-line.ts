import {
  CLAUDE_STATUSLINE_RELAY_MAX_ARGUMENT_CHARS,
  encodeClaudeStatusLineRelayRequest
} from '../../../shared/claude-statusline-relay-contract'
import { quotePosixShell } from '../../../shared/wsl-login-shell-command'
import type { PrimaryStatusLineRelayContext } from './primary-session-status-line-context'

/** The user's own `statusLine`, read at launch; only the fields Claude Code documents. */
export type UserStatusLine = {
  readonly command: string
  readonly padding?: number
  readonly refreshInterval?: number
  readonly hideVimModeIndicator?: boolean
}

/** The `statusLine` entry of the generated settings, in the shape the settings reference gives. */
export type PrimaryStatusLineSetting = {
  readonly type: 'command'
  readonly command: string
  readonly padding?: number
  readonly refreshInterval?: number
  readonly hideVimModeIndicator?: boolean
}

const NODE_VARIABLE = 'nash_relay_node'
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:\\/

/**
 * The relay command for one primary session. It runs the relay script with the node runtime
 * NASH's other hooks use (`ORCA_AGENT_HOOK_NODE`, the app binary otherwise) and passes the user's
 * command as one base64url argument, never as shell text. Null when the argument would not fit.
 */
export function buildPrimaryStatusLine(
  context: PrimaryStatusLineRelayContext,
  user: UserStatusLine | null
): PrimaryStatusLineSetting | null {
  const argument = encodeClaudeStatusLineRelayRequest({
    shell: context.shellPath,
    command: user?.command ?? null
  })
  if (argument.length > CLAUDE_STATUSLINE_RELAY_MAX_ARGUMENT_CHARS) {
    return null
  }
  const fallbackNode = quotePosixShell(shellPath(context.nodeRuntimePath))
  const command = [
    `if [ -n "\${ORCA_AGENT_HOOK_NODE-}" ]; then ${NODE_VARIABLE}=$ORCA_AGENT_HOOK_NODE;`,
    `else ${NODE_VARIABLE}=${fallbackNode}; fi;`,
    'export ELECTRON_RUN_AS_NODE=1;',
    `exec "$${NODE_VARIABLE}"`,
    quotePosixShell(shellPath(context.relayScriptPath)),
    argument
  ].join(' ')
  return {
    type: 'command',
    command,
    ...(user?.padding !== undefined ? { padding: user.padding } : {}),
    ...(user?.refreshInterval !== undefined ? { refreshInterval: user.refreshInterval } : {}),
    ...(user?.hideVimModeIndicator !== undefined
      ? { hideVimModeIndicator: user.hideVimModeIndicator }
      : {})
  }
}

/** Why forward slashes: the spelling Orca's Windows hook commands use under Git Bash; Windows takes either. */
function shellPath(path: string): string {
  return WINDOWS_DRIVE_PATH.test(path) ? path.replaceAll('\\', '/') : path
}

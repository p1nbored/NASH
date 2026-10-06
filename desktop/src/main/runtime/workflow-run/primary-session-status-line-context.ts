import { posix, win32 } from 'node:path'
import {
  CLAUDE_STATUSLINE_RELAY_DIRECTORY,
  CLAUDE_STATUSLINE_RELAY_ENTRY_FILE
} from '../../../shared/claude-statusline-relay-contract'
import { resolveGitBashPath } from '../../git-bash'

/** What the status-line relay needs from the running app, resolved once per launch. */
export type PrimaryStatusLineRelayContext = {
  /** The app binary, run as Node when the pane carries no `ORCA_AGENT_HOOK_NODE`. */
  readonly nodeRuntimePath: string
  /** The compiled relay, `out/cli/statusline-relay/claude-statusline-relay.js`. */
  readonly relayScriptPath: string
  /** The shell Claude Code runs status-line commands in: Git Bash on Windows, sh elsewhere. */
  readonly shellPath: string
  /** The user's Claude settings: `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`. */
  readonly userSettingsPath: string
}

export type StatusLineRelayHostFacts = {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly isPackaged: boolean
  readonly appPath: string
  readonly resourcesPath: string | undefined
  readonly execPath: string
  readonly homeDir: string
  exists(path: string): boolean
}

// Claude Code's documented names for CLAUDE_CODE_GIT_BASH_PATH; any other file is ignored.
const CLAUDE_CODE_SHELL_FILE_NAMES = new Set(['bash.exe', 'sh.exe', 'bash', 'sh'])

/**
 * Null means no relay this launch: the session keeps the user's own status line and NASH gets no
 * Claude usage. Windows without Git Bash is one such case, because Claude Code would then run
 * status-line commands through PowerShell, and the relay never builds a PowerShell path.
 */
export function resolvePrimaryStatusLineRelayContext(
  facts: StatusLineRelayHostFacts
): PrimaryStatusLineRelayContext | null {
  const path = facts.platform === 'win32' ? win32 : posix
  const outRoot = facts.isPackaged
    ? facts.resourcesPath && path.join(facts.resourcesPath, 'app.asar.unpacked')
    : facts.appPath
  if (!outRoot) {
    return null
  }
  const relayScriptPath = path.join(
    outRoot,
    'out',
    'cli',
    CLAUDE_STATUSLINE_RELAY_DIRECTORY,
    CLAUDE_STATUSLINE_RELAY_ENTRY_FILE
  )
  const shellPath = resolveStatusLineShell(facts)
  if (!facts.exists(relayScriptPath) || shellPath === null) {
    return null
  }
  const configDir = facts.env.CLAUDE_CONFIG_DIR?.trim()
  return {
    nodeRuntimePath: facts.execPath,
    relayScriptPath,
    shellPath,
    userSettingsPath: configDir
      ? path.join(configDir, 'settings.json')
      : path.join(facts.homeDir, '.claude', 'settings.json')
  }
}

function resolveStatusLineShell(facts: StatusLineRelayHostFacts): string | null {
  if (facts.platform !== 'win32') {
    return '/bin/sh'
  }
  const configured = facts.env.CLAUDE_CODE_GIT_BASH_PATH?.trim()
  if (
    configured &&
    win32.isAbsolute(configured) &&
    CLAUDE_CODE_SHELL_FILE_NAMES.has(win32.basename(configured).toLowerCase()) &&
    facts.exists(configured)
  ) {
    return configured
  }
  return resolveGitBashPath({ env: facts.env, exists: facts.exists, platform: 'win32' })
}

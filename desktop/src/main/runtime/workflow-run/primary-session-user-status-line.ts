import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CLAUDE_STATUSLINE_RELAY_DIRECTORY } from '../../../shared/claude-statusline-relay-contract'
import type { UserStatusLine } from './primary-session-status-line'

/** A settings file's text, or null when it is missing, unreadable or too large. */
export type StatusLineSettingsReader = (path: string) => string | null

const SETTINGS_FILE_MAX_BYTES = 1024 * 1024
// Why: chaining NASH's own relay, or a managed relay an Orca build wrote, would post twice or run a .cmd.
const OWN_STATUS_LINE_MARKERS = [
  `/${CLAUDE_STATUSLINE_RELAY_DIRECTORY}/`,
  '/agent-hooks/claude-statusline'
]

export function readBoundedSettingsText(path: string): string | null {
  try {
    return statSync(path).size > SETTINGS_FILE_MAX_BYTES ? null : readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * The status line the session would show without NASH's `--settings`, in Claude Code's documented
 * precedence: project local, then shared project, then user settings. Only the `statusLine` key is
 * read; nothing else in those files is kept, logged or copied.
 */
export function resolveUserStatusLine(args: {
  readonly workspacePath: string
  readonly userSettingsPath: string
  readonly read: StatusLineSettingsReader
}): UserStatusLine | null {
  const files = [
    join(args.workspacePath, '.claude', 'settings.local.json'),
    join(args.workspacePath, '.claude', 'settings.json'),
    args.userSettingsPath
  ]
  for (const file of files) {
    const statusLine = statusLineIn(args.read(file))
    if (statusLine !== undefined) {
      return statusLine
    }
  }
  return null
}

/** undefined: this file sets no status line; null: it sets NASH's own, which is not chained. */
function statusLineIn(text: string | null): UserStatusLine | null | undefined {
  let settings: unknown
  try {
    settings = text === null ? null : JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof settings !== 'object' || settings === null || !('statusLine' in settings)) {
    return undefined
  }
  const entry = settings.statusLine
  if (typeof entry !== 'object' || entry === null || !('type' in entry) || !('command' in entry)) {
    return undefined
  }
  if (entry.type !== 'command' || typeof entry.command !== 'string' || !entry.command.trim()) {
    return undefined
  }
  const normalized = entry.command.replaceAll('\\', '/')
  if (OWN_STATUS_LINE_MARKERS.some((marker) => normalized.includes(marker))) {
    return null
  }
  return { command: entry.command, ...optionalFields(entry) }
}

function optionalFields(entry: object): Omit<UserStatusLine, 'command'> {
  const padding = 'padding' in entry ? entry.padding : undefined
  const refreshInterval = 'refreshInterval' in entry ? entry.refreshInterval : undefined
  const hideVim = 'hideVimModeIndicator' in entry ? entry.hideVimModeIndicator : undefined
  return {
    ...(typeof padding === 'number' && Number.isFinite(padding) && padding >= 0 ? { padding } : {}),
    ...(typeof refreshInterval === 'number' &&
    Number.isFinite(refreshInterval) &&
    refreshInterval >= 1
      ? { refreshInterval }
      : {}),
    ...(typeof hideVim === 'boolean' ? { hideVimModeIndicator: hideVim } : {})
  }
}

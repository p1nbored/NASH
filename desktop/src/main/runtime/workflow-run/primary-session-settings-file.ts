import { join } from 'node:path'
import {
  AUTOPILOT_AGENT_COMMANDS,
  PERMISSION_HOOK_TIMEOUT_SECONDS,
  autopilotBashAllowRule,
  autopilotCliInvocation,
  isCliCommandName
} from '../../../shared/workflow-run/autopilot-cli-commands'
import { writeSecureJsonFile } from '../../../shared/secure-file'
import type { PrimaryStatusLineSetting } from './primary-session-status-line'
import {
  primarySessionOk,
  primarySessionRefused,
  type PrimarySessionAccess,
  type PrimarySessionResult
} from './primary-session-types'

/**
 * The generated `--settings` file. Every key and value below is from the local Claude Code docs:
 * `permissions.disableBypassPermissionsMode`, `permissions.disableAutoMode`, `useAutoModeDuringPlan`
 * (honored from `--settings`), `permissions.allow` and `permissions.deny` rules, a
 * PermissionRequest command hook with an explicit `timeout` in seconds, and a `statusLine` command
 * (the usage relay, user decision of 2026-10-06).
 */
export type PrimarySessionSettings = {
  readonly permissions: {
    readonly disableBypassPermissionsMode: 'disable'
    readonly disableAutoMode: 'disable'
    readonly allow: readonly string[]
    readonly deny?: readonly string[]
  }
  readonly useAutoModeDuringPlan: false
  readonly hooks: {
    readonly PermissionRequest: readonly [
      {
        readonly matcher: '*'
        readonly hooks: readonly [
          {
            readonly type: 'command'
            readonly command: string
            readonly timeout: number
          }
        ]
      }
    ]
  }
  readonly statusLine?: PrimaryStatusLineSetting
}

// Tool-level denies: a path-less Edit, Write or NotebookEdit rule removes the tool in every mode.
const READ_ONLY_DENY_RULES = ['Edit', 'Write', 'NotebookEdit'] as const
const SETTINGS_DIRECTORY = 'primary-sessions'
// Why: the run id becomes part of a file name, so it must not reach outside the directory.
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function buildPrimarySessionSettings(args: {
  readonly access: PrimarySessionAccess
  readonly cliCommand: string
  /** The status-line relay; null or absent leaves the user's own status line in effect. */
  readonly statusLine?: PrimaryStatusLineSetting | null
}): PrimarySessionResult<PrimarySessionSettings> {
  if (!isCliCommandName(args.cliCommand)) {
    return primarySessionRefused(
      'autopilot_session_cli_name_invalid',
      'The CLI command name must be one bare word.'
    )
  }
  const allow = AUTOPILOT_AGENT_COMMANDS.map((command) =>
    autopilotBashAllowRule(args.cliCommand, command)
  )
  return primarySessionOk({
    permissions: {
      disableBypassPermissionsMode: 'disable',
      disableAutoMode: 'disable',
      allow,
      ...(args.access === 'read_only' ? { deny: [...READ_ONLY_DENY_RULES] } : {})
    },
    useAutoModeDuringPlan: false,
    hooks: {
      PermissionRequest: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: autopilotCliInvocation(args.cliCommand, 'permission-request'),
              timeout: PERMISSION_HOOK_TIMEOUT_SECONDS
            }
          ]
        }
      ]
    },
    ...(args.statusLine ? { statusLine: args.statusLine } : {})
  })
}

/** `<userData>/primary-sessions/<run>-g<generation>.json`, or a refusal for an unsafe part. */
export function primarySessionSettingsPath(args: {
  readonly userDataPath: string
  readonly runId: string
  readonly generation: number
}): PrimarySessionResult<string> {
  if (
    args.userDataPath.trim() === '' ||
    !RUN_ID.test(args.runId) ||
    args.runId.includes('..') ||
    !Number.isInteger(args.generation) ||
    args.generation < 1
  ) {
    return primarySessionRefused(
      'autopilot_session_settings_path_invalid',
      'The settings file location needs a user data path, a simple run id and a generation of 1 or more.'
    )
  }
  return primarySessionOk(
    join(args.userDataPath, SETTINGS_DIRECTORY, `${args.runId}-g${args.generation}.json`)
  )
}

/** Returns false when the file was written but its permissions could not be restricted. */
export type SecureJsonWriter = (targetPath: string, value: unknown) => boolean

/** Writes the file owner-only. A file that is not owner-only is a refusal, so the launch stops. */
export function writePrimarySessionSettingsFile(
  args: {
    readonly userDataPath: string
    readonly runId: string
    readonly generation: number
    readonly settings: PrimarySessionSettings
  },
  write: SecureJsonWriter = writeSecureJsonFile
): PrimarySessionResult<{ readonly path: string }> {
  const location = primarySessionSettingsPath(args)
  if (!location.ok) {
    return location
  }
  let restricted: boolean
  try {
    restricted = write(location.value, args.settings)
  } catch {
    return primarySessionRefused(
      'autopilot_session_settings_write_failed',
      'The primary session settings file could not be written.'
    )
  }
  if (!restricted) {
    return primarySessionRefused(
      'autopilot_session_settings_not_owner_only',
      'The primary session settings file could not be restricted to the current user.'
    )
  }
  return primarySessionOk({ path: location.value })
}

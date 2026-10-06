import type { PermissionRelayInputKey } from '../../../shared/rpc-contract/permission-relay-params'
import { isDesktopOnlyCommand } from './permission-command-guard'
import { joinForMatching, normalizePathForMatching } from './permission-path-normalization'
import {
  isInAppData,
  isSensitivePath,
  normalizeAppDataDirectories,
  type SensitivePathContext
} from './permission-sensitive-paths'

/**
 * Who may answer a permission prompt (D-017, plan U26). dot answers only prompts whose summary
 * shows exactly what will run or be touched; everything else stays with the desktop, and dialogs
 * that need more than a yes or no stay in the terminal.
 */
export type PermissionAudience = 'terminal_only' | 'desktop_only' | 'dot_and_desktop'

export type PermissionRelayInput = {
  toolName: string
  agentId: string | null
  cwd: string | null
  toolInput: Partial<Record<PermissionRelayInputKey, string>>
}

/** Their dialogs carry answers or a permission-mode choice that an allow or deny cannot express. */
export const TERMINAL_ONLY_TOOLS: readonly string[] = ['AskUserQuestion', 'ExitPlanMode']

type ToolDetail = {
  readonly required: PermissionRelayInputKey
  readonly paths: readonly PermissionRelayInputKey[]
}

/** The only tools dot may answer, with the field their summary must show and the fields that name paths. */
export const DOT_ANSWERABLE_TOOLS: Readonly<Record<string, ToolDetail>> = {
  Bash: { required: 'command', paths: [] },
  PowerShell: { required: 'command', paths: [] },
  Monitor: { required: 'command', paths: [] },
  Read: { required: 'file_path', paths: ['file_path'] },
  Edit: { required: 'file_path', paths: ['file_path'] },
  Write: { required: 'file_path', paths: ['file_path'] },
  NotebookEdit: { required: 'notebook_path', paths: ['notebook_path'] },
  Glob: { required: 'pattern', paths: ['path', 'pattern'] }
}

/** What each summary names: the answerable tools, plus Grep's search root for the desktop. */
export const TOOL_SUMMARY_DETAILS: Readonly<Record<string, ToolDetail>> = {
  ...DOT_ANSWERABLE_TOOLS,
  Grep: { required: 'path', paths: ['path'] }
}

/**
 * Desktop-only by name: their effect cannot be shown as a command or file name (a URL, a query, a
 * skill, a subagent, publishing, scheduling, messaging or a working-directory move). Grep searches
 * every file below its path and its summary leaves the pattern out. MCP tools and any tool missing
 * from both lists are desktop-only as well.
 */
export const DESKTOP_ONLY_TOOLS: readonly string[] = [
  'Agent',
  'Artifact',
  'CronCreate',
  'EnterPlanMode',
  'EnterWorktree',
  'Grep',
  'PushNotification',
  'RemoteTrigger',
  'ScheduleWakeup',
  'SendFeedback',
  'SendMessage',
  'SendUserFile',
  'ShareOnboardingGuide',
  'Skill',
  'WebFetch',
  'WebSearch',
  'Workflow'
]

/** True for a tool dot may never answer, whatever its input. */
export function isDesktopOnlyTool(toolName: string): boolean {
  return !Object.hasOwn(DOT_ANSWERABLE_TOOLS, toolName)
}

/** A Glob pattern is relative to its search root; every other path to the working directory. */
function baseFor(key: PermissionRelayInputKey, input: PermissionRelayInput): string | null {
  const root = input.toolInput.path
  return key === 'pattern' && root ? joinForMatching(input.cwd, root) : input.cwd
}

function touchesSensitivePath(
  detail: ToolDetail,
  input: PermissionRelayInput,
  appData: SensitivePathContext['appData']
): boolean {
  return detail.paths.some((key) => {
    const value = input.toolInput[key]
    return (
      value !== undefined &&
      value !== '' &&
      isSensitivePath(value, { base: baseFor(key, input), appData })
    )
  })
}

function worksInsideAppData(cwd: string | null, appData: SensitivePathContext['appData']): boolean {
  const normalized = cwd ? normalizePathForMatching(cwd) : null
  return normalized !== null && isInAppData(normalized, { base: null, appData })
}

/**
 * Decides who may answer. `controlPlaneCommands` names the app's own CLI; it is checked together
 * with `claude` and `orca`, because a command that steers the agent or the app must not be approved
 * from outside the desktop. Every path under `appDataDirectories` (the app's data folder) is
 * desktop-only.
 */
export function classifyPermissionAudience(
  input: PermissionRelayInput,
  controlPlaneCommands: readonly string[],
  appDataDirectories: readonly string[] = []
): PermissionAudience {
  if (TERMINAL_ONLY_TOOLS.includes(input.toolName)) {
    return 'terminal_only'
  }
  if (isDesktopOnlyTool(input.toolName)) {
    return 'desktop_only'
  }
  const detail = DOT_ANSWERABLE_TOOLS[input.toolName]
  const required = detail ? input.toolInput[detail.required]?.trim() : undefined
  if (!detail || !required) {
    return 'desktop_only'
  }
  const appData = normalizeAppDataDirectories(appDataDirectories)
  if (worksInsideAppData(input.cwd, appData) || touchesSensitivePath(detail, input, appData)) {
    return 'desktop_only'
  }
  const command = input.toolInput.command
  if (detail.required === 'command' && command !== undefined) {
    const controlPlane = new Set(
      ['claude', 'orca', ...controlPlaneCommands].map((name) => name.toLowerCase())
    )
    if (isDesktopOnlyCommand(command, { base: input.cwd, appData, controlPlane })) {
      return 'desktop_only'
    }
  }
  return 'dot_and_desktop'
}

import { posix, win32 } from 'node:path'
import { toAgentLaunchPreferences } from '../../../shared/agent-launch-preferences'
import type { AgentLaunchPreferences } from '../../../shared/agent-session-host-authority'
import {
  resolveAgentStartupPlanInputs,
  type AgentStartupSettings
} from '../../../shared/agent-startup-plan-inputs'
import type { NativeChatDefaultSettings } from '../../../shared/structured-native-chat-launch-route'
import {
  buildAgentStartupPlan,
  quoteStartupArg,
  resolveStartupShell,
  type AgentStartupPlan,
  type AgentStartupShell
} from '../../../shared/tui-agent-startup'
import { tokenizeStartupCommand } from '../../../shared/tui-agent-startup-shell'
import {
  buildPrimarySessionArgv,
  checkPrimaryArgvSafety,
  findForbiddenPermissionText,
  resolvePrimaryPermissionMode
} from './primary-session-permission'
import {
  parseClaudeModelChoice,
  primarySessionOk,
  primarySessionRefused,
  type PrimaryPermissionMode,
  type PrimarySessionAccess,
  type PrimarySessionResult
} from './primary-session-types'

/** The slice of the user's client settings a launch reads. */
export type PrimarySessionClientSettings = AgentStartupSettings & Partial<NativeChatDefaultSettings>

export type PrimarySessionPreflightInput = {
  readonly settings: PrimarySessionClientSettings
  readonly platform: NodeJS.Platform
  readonly access: PrimarySessionAccess
  readonly settingsFilePath: string
  readonly agentsJson: string | null
  /** The coordinator route's model and resolved Claude effort. */
  readonly model: string
  readonly effort: string
}

export type PrimarySessionLaunchSpec = {
  /** The replacement for the Settings default arguments; `YOLO_TUI_AGENT_ARGS` never applies. */
  readonly agentArgs: string
  readonly permissionMode: PrimaryPermissionMode
  readonly sessionOptions: { readonly model: string; readonly effort: string }
  readonly launchPreferences: AgentLaunchPreferences | undefined
  readonly shell: AgentStartupShell
  /** The command the check built with a neutral prompt, for the launch receipt and diagnostics. */
  readonly probeCommand: string
}

type FlagPair = readonly [string, string]

/** The startup plan builder; injected so a test can show what the checks do with a bad plan. */
export type StartupPlanBuilder = typeof buildAgentStartupPlan

// Why: the check runs on a neutral prompt, so the objective's own words can never trip a bypass scan.
const PROBE_PROMPT = 'Preflight probe.'

/** Settings as the launch must see them: structured native chat off, so the session is a terminal. */
export function withStructuredNativeChatDisabled<T extends Partial<NativeChatDefaultSettings>>(
  settings: T
): T & { readonly experimentalStructuredNativeChat: false } {
  return { ...settings, experimentalStructuredNativeChat: false }
}

function quoteForTokenizer(value: string, shell: AgentStartupShell): string | null {
  if (shell === 'powershell') {
    return `'${value.replaceAll("'", "''")}'`
  }
  if (shell === 'posix') {
    return `'${value.replaceAll("'", `'\\''`)}'`
  }
  return null
}

/** Joins the argument vector into the agentArgs string, and proves the tokenizer reads it back whole. */
function toAgentArgs(
  argv: readonly string[],
  shell: AgentStartupShell
): PrimarySessionResult<string> {
  const quoted = argv.map((token) => quoteForTokenizer(token, shell))
  if (quoted.some((token) => token === null)) {
    return primarySessionRefused(
      'autopilot_session_unsupported_shell',
      'A cmd.exe terminal cannot carry the session arguments safely; use PowerShell or Git Bash.'
    )
  }
  const text = quoted.join(' ')
  const tokenized = tokenizeStartupCommand(text, shell)
  const intact =
    tokenized.ok &&
    tokenized.tokens.length === argv.length &&
    tokenized.tokens.every((token, index) => token === argv[index]) &&
    !tokenized.spans.some((span) => span.divergesFromShell)
  return intact
    ? primarySessionOk(text)
    : primarySessionRefused(
        'autopilot_session_quoting_unsafe',
        'A session argument would not survive shell quoting unchanged.'
      )
}

function pairsOf(argv: readonly string[]): readonly FlagPair[] {
  const pairs: FlagPair[] = []
  for (let index = 0; index + 1 < argv.length; index += 2) {
    pairs.push([argv[index], argv[index + 1]])
  }
  return pairs
}

function hasControlCharacter(text: string): boolean {
  return Array.from(text).some((char) => (char.codePointAt(0) ?? 0) < 0x20)
}

function settingsPathIsUsable(path: string, platform: NodeJS.Platform): boolean {
  const flavor = platform === 'win32' ? win32 : posix
  return path.trim() !== '' && !hasControlCharacter(path) && flavor.isAbsolute(path)
}

function checkPlan(
  plan: AgentStartupPlan,
  expected: readonly FlagPair[],
  shell: AgentStartupShell
): PrimarySessionResult<null> {
  const carriesEveryPair = expected.every(([flag, value]) =>
    plan.launchCommand.includes(`${quoteStartupArg(flag, shell)} ${quoteStartupArg(value, shell)}`)
  )
  const applied = plan.sessionOptions ?? {}
  const appliedModel = applied.model
  const appliedEffort = applied.effort
  const expectedOptions = expected.filter(([flag]) => flag === '--model' || flag === '--effort')
  const optionsApplied = expectedOptions.every(
    ([flag, value]) => (flag === '--model' ? appliedModel : appliedEffort) === value
  )
  if (
    plan.agent !== 'claude' ||
    plan.followupPrompt !== null ||
    !carriesEveryPair ||
    !optionsApplied
  ) {
    return primarySessionRefused(
      'autopilot_session_startup_plan_mismatch',
      'The startup plan does not carry the permission mode, settings file, subagents, model and effort as built.'
    )
  }
  const forbidden = findForbiddenPermissionText(plan.launchCommand)
  return forbidden ? { ok: false, refusal: forbidden } : primarySessionOk(null)
}

/**
 * Checks, with no side effect, that a primary session launch would start exactly as designed: the
 * override is off, the arguments are the allowed ones, they survive this host's shell quoting, and
 * the real startup plan carries them with no bypass or auto token. Nothing is spawned or written.
 */
export function runPrimarySessionPreflight(
  input: PrimarySessionPreflightInput,
  buildPlan: StartupPlanBuilder = buildAgentStartupPlan
): PrimarySessionResult<PrimarySessionLaunchSpec> {
  if (input.settings.agentCmdOverrides?.claude) {
    return primarySessionRefused(
      'autopilot_session_command_override',
      'The Claude launch command is overridden in Settings; remove the override to start a run.'
    )
  }
  const mode = resolvePrimaryPermissionMode(input.access)
  const choice = parseClaudeModelChoice(input.model, input.effort)
  if (!mode.ok) {
    return mode
  }
  if (!choice.ok) {
    return choice
  }
  if (!settingsPathIsUsable(input.settingsFilePath, input.platform)) {
    return primarySessionRefused(
      'autopilot_session_settings_path_invalid',
      'The settings file path must be an absolute path without control characters.'
    )
  }
  const argv = buildPrimarySessionArgv({
    mode: mode.value,
    settingsFilePath: input.settingsFilePath,
    agentsJson: input.agentsJson
  })
  const expected: readonly FlagPair[] = [
    ...pairsOf(argv),
    ['--model', choice.value.model],
    ['--effort', choice.value.effort]
  ]
  const safe = checkPrimaryArgvSafety(expected.flat())
  if (!safe.ok) {
    return safe
  }
  const sessionOptions = { model: choice.value.model, effort: choice.value.effort }
  const base = resolveAgentStartupPlanInputs({
    agent: 'claude',
    settings: input.settings,
    platform: input.platform,
    isRemote: false,
    agentArgs: null,
    sessionOptions
  })
  const shell = resolveStartupShell(input.platform, base.shell)
  const agentArgs = toAgentArgs(argv, shell)
  if (!agentArgs.ok) {
    return agentArgs
  }
  const plan = buildPlan({ ...base, agentArgs: agentArgs.value, prompt: PROBE_PROMPT })
  if (!plan) {
    return primarySessionRefused(
      'autopilot_session_startup_plan_unavailable',
      'The startup plan could not be built from the session arguments.'
    )
  }
  const checked = checkPlan(plan, expected, shell)
  if (!checked.ok) {
    return checked
  }
  return primarySessionOk({
    agentArgs: agentArgs.value,
    permissionMode: mode.value,
    sessionOptions,
    launchPreferences: toAgentLaunchPreferences(sessionOptions),
    shell,
    probeCommand: plan.launchCommand
  })
}

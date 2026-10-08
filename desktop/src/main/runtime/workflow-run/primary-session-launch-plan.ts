import { buildPrimarySessionAgents } from './primary-session-agents'
import {
  runPrimarySessionPreflight,
  withStructuredNativeChatDisabled,
  type PrimarySessionClientSettings,
  type PrimarySessionLaunchSpec,
  type StartupPlanBuilder
} from './primary-session-preflight'
import { buildPrimarySessionPrompt, type PrimarySessionPrompt } from './primary-session-prompt'
import {
  buildPrimarySessionSettings,
  primarySessionSettingsPath,
  writePrimarySessionSettingsFile,
  type SecureJsonWriter
} from './primary-session-settings-file'
import {
  buildPrimaryStatusLine,
  type PrimaryStatusLineSetting
} from './primary-session-status-line'
import type { PrimaryStatusLineRelayContext } from './primary-session-status-line-context'
import {
  readBoundedSettingsText,
  resolveUserStatusLine,
  type StatusLineSettingsReader
} from './primary-session-user-status-line'
import {
  parseClaudeModelChoice,
  primarySessionOk,
  type PrimarySessionAccess,
  type PrimarySessionAgent,
  type PrimarySessionResult,
  type SubagentRouteRowInput
} from './primary-session-types'

export type PrimarySessionLaunchPlanInput = {
  readonly agent: PrimarySessionAgent
  readonly userDataPath: string
  readonly platform: NodeJS.Platform
  readonly cliCommand: string
  readonly clientSettings: PrimarySessionClientSettings
  readonly runId: string
  readonly generation: number
  readonly access: PrimarySessionAccess
  readonly objective: string
  /** The coordinator route's exact model and resolved provider effort. */
  readonly model: string
  readonly effort: string
  /** Every row of the active table; only claude_subagent rows become `--agents` definitions. */
  readonly routeRows: readonly SubagentRouteRowInput[]
  /** The session's working folder, where Claude Code reads the project's own settings. */
  readonly workspacePath?: string
  /** Null or absent: no status-line relay, so the user's own status line stays in effect. */
  readonly statusLineRelay?: PrimaryStatusLineRelayContext | null
}

export type PrimarySessionLaunchPlan = PrimarySessionLaunchSpec & {
  readonly prompt: PrimarySessionPrompt
  readonly settingsPath: string | null
  readonly subagentNames: readonly string[]
}

export type PrimarySessionLaunchPlanIo = {
  readonly writeSettings?: SecureJsonWriter
  readonly buildPlan?: StartupPlanBuilder
  readonly readSettingsText?: StatusLineSettingsReader
}

/** The usage relay for this session, chaining the user's own status line (G8). */
function primaryStatusLine(
  input: PrimarySessionLaunchPlanInput,
  read: StatusLineSettingsReader
): PrimaryStatusLineSetting | null {
  const relay = input.statusLineRelay
  if (!relay || !input.workspacePath) {
    return null
  }
  const user = resolveUserStatusLine({
    workspacePath: input.workspacePath,
    userSettingsPath: relay.userSettingsPath,
    read
  })
  return buildPrimaryStatusLine(relay, user)
}

/**
 * A3's helpers in launch order: everything that can be refused without a side effect first, then the
 * owner-only settings file, then the preflight against the real startup plan with structured native
 * chat forced off. Nothing is spawned.
 */
export function preparePrimarySessionLaunch(
  input: PrimarySessionLaunchPlanInput,
  io: PrimarySessionLaunchPlanIo = {}
): PrimarySessionResult<PrimarySessionLaunchPlan> {
  const prompt = buildPrimarySessionPrompt({
    agent: input.agent,
    objective: input.objective,
    access: input.access,
    cliCommand: input.cliCommand,
    platform: input.platform
  })
  if (!prompt.ok) {
    return prompt
  }
  if (input.agent === 'codex') {
    const spec = runPrimarySessionPreflight(
      {
        agent: 'codex',
        settings: withStructuredNativeChatDisabled(input.clientSettings),
        platform: input.platform,
        access: input.access,
        model: input.model,
        effort: input.effort
      },
      io.buildPlan
    )
    return spec.ok
      ? primarySessionOk({
          ...spec.value,
          prompt: prompt.value,
          settingsPath: null,
          subagentNames: []
        })
      : spec
  }
  const choice = parseClaudeModelChoice(input.model, input.effort)
  if (!choice.ok) {
    return choice
  }
  const agents = buildPrimarySessionAgents(input.routeRows)
  if (!agents.ok) {
    return agents
  }
  const settings = buildPrimarySessionSettings({
    access: input.access,
    cliCommand: input.cliCommand,
    statusLine: primaryStatusLine(input, io.readSettingsText ?? readBoundedSettingsText)
  })
  if (!settings.ok) {
    return settings
  }
  const location = {
    userDataPath: input.userDataPath,
    runId: input.runId,
    generation: input.generation
  }
  const path = primarySessionSettingsPath(location)
  if (!path.ok) {
    return path
  }
  const written = writePrimarySessionSettingsFile(
    { ...location, settings: settings.value },
    io.writeSettings
  )
  if (!written.ok) {
    return written
  }
  const spec = runPrimarySessionPreflight(
    {
      agent: 'claude',
      settings: withStructuredNativeChatDisabled(input.clientSettings),
      platform: input.platform,
      access: input.access,
      settingsFilePath: written.value.path,
      agentsJson: agents.value.json,
      model: choice.value.model,
      effort: choice.value.effort
    },
    io.buildPlan
  )
  if (!spec.ok) {
    return spec
  }
  return primarySessionOk({
    ...spec.value,
    prompt: prompt.value,
    settingsPath: written.value.path,
    subagentNames: agents.value.names
  })
}

import { describe, expect, it } from 'vitest'
import { resolveAgentStartupPlanInputs } from '../../../shared/agent-startup-plan-inputs'
import {
  buildAgentStartupPlan,
  quoteStartupArg,
  type AgentStartupShell
} from '../../../shared/tui-agent-startup'
import { tokenizeStartupCommand } from '../../../shared/tui-agent-startup-shell'
import { prefersStructuredNativeChatByDefault } from '../../../shared/structured-native-chat-launch-route'
import { decideAgentLaunchMode } from '../../agent-launch/agent-launch-mode'
import {
  runPrimarySessionPreflight,
  withStructuredNativeChatDisabled,
  type PrimarySessionPreflightInput,
  type StartupPlanBuilder
} from './primary-session-preflight'
import { buildPrimarySessionAgents } from './primary-session-agents'
import { findForbiddenPermissionText } from './primary-session-permission'
import type { SubagentRouteRowInput } from './primary-session-types'

const SPACED_PATH =
  'C:\\Users\\Test User\\AppData\\Roaming\\NASH App\\primary-sessions\\run_1-g1.json'

// FIXTURE_ONLY: two claude_subagent rows, so the agents JSON has realistic size and shape.
const SUBAGENT_ROWS: readonly SubagentRouteRowInput[] = [
  {
    taskType: 'software_engineering',
    executionTarget: 'claude_subagent',
    model: 'claude-sonnet-5-5',
    effort: 'max'
  },
  {
    taskType: 'high_quality_writing',
    executionTarget: 'claude_subagent',
    model: 'claude-opus-5-5',
    effort: 'high'
  }
]

function agentsJson(): string {
  const result = buildPrimarySessionAgents(SUBAGENT_ROWS)
  if (!result.ok || result.value.json === null) {
    throw new Error('expected agents JSON')
  }
  return result.value.json
}

function inputFor(
  overrides: Partial<PrimarySessionPreflightInput> = {}
): PrimarySessionPreflightInput {
  return {
    settings: {},
    platform: 'win32',
    access: 'read_only',
    settingsFilePath: SPACED_PATH,
    agentsJson: agentsJson(),
    model: 'claude-opus-5-5',
    effort: 'max',
    ...overrides
  }
}

function specFor(overrides: Partial<PrimarySessionPreflightInput> = {}) {
  const result = runPrimarySessionPreflight(inputFor(overrides))
  if (!result.ok) {
    throw new Error(`expected a launch spec, got ${result.refusal.code}: ${result.refusal.detail}`)
  }
  return result.value
}

function refusalFor(overrides: Partial<PrimarySessionPreflightInput> = {}) {
  const result = runPrimarySessionPreflight(inputFor(overrides))
  if (result.ok) {
    throw new Error('expected a refusal')
  }
  return result.refusal
}

/** What the launcher's own startup plan builds from the spec, with a prompt that names bypass words. */
function launcherCommand(
  spec: ReturnType<typeof specFor>,
  platform: NodeJS.Platform,
  settings = {}
): string {
  const inputs = resolveAgentStartupPlanInputs({
    agent: 'claude',
    settings,
    platform,
    isRemote: false,
    agentArgs: spec.agentArgs,
    sessionOptions: spec.sessionOptions
  })
  const plan = buildAgentStartupPlan({
    ...inputs,
    prompt: 'You are the primary session. Explain what bypassPermissions means.'
  })
  if (!plan) {
    throw new Error('expected a startup plan')
  }
  return plan.launchCommand
}

function quoted(value: string, shell: AgentStartupShell): string {
  return quoteStartupArg(value, shell)
}

describe('runPrimarySessionPreflight command override', () => {
  it('refuses the launch when the Claude launch command is overridden', () => {
    const refusal = refusalFor({
      settings: { agentCmdOverrides: { claude: 'my-claude --wrapped' } }
    })
    expect(refusal.code).toBe('autopilot_session_command_override')
  })

  it('refuses a whitespace-only override too, because the launcher would still use it', () => {
    expect(refusalFor({ settings: { agentCmdOverrides: { claude: '   ' } } }).code).toBe(
      'autopilot_session_command_override'
    )
  })

  it('ignores an override for another agent and an empty Claude override', () => {
    expect(
      runPrimarySessionPreflight(inputFor({ settings: { agentCmdOverrides: { codex: 'x' } } })).ok
    ).toBe(true)
    expect(
      runPrimarySessionPreflight(inputFor({ settings: { agentCmdOverrides: { claude: '' } } })).ok
    ).toBe(true)
  })
})

describe('withStructuredNativeChatDisabled', () => {
  const structuredDefault = {
    experimentalNativeChat: true,
    openAgentTabsInChatByDefault: true,
    experimentalStructuredNativeChat: true
  }

  it('forces terminal mode even when structured chat is the user default', () => {
    expect(prefersStructuredNativeChatByDefault(structuredDefault)).toBe(true)
    const forced = withStructuredNativeChatDisabled(structuredDefault)
    expect(prefersStructuredNativeChatByDefault(forced)).toBe(false)
    const receipt = decideAgentLaunchMode({ placement: { agent: 'claude' }, settings: forced })
    expect(receipt.mode).toBe('terminal')
    expect(receipt.reason).toBe('user_default')
  })

  it('shows the user default would otherwise start a structured session', () => {
    const receipt = decideAgentLaunchMode({
      placement: { agent: 'claude' },
      settings: structuredDefault
    })
    expect(receipt.mode).toBe('structured')
  })

  it('keeps every other setting and does not mutate its input', () => {
    const original = Object.freeze({ ...structuredDefault, agentCmdOverrides: { codex: 'c' } })
    const forced = withStructuredNativeChatDisabled(original)
    expect(forced).not.toBe(original)
    expect(forced.agentCmdOverrides).toEqual({ codex: 'c' })
    expect(forced.openAgentTabsInChatByDefault).toBe(true)
    expect(original.experimentalStructuredNativeChat).toBe(true)
  })
})

describe('runPrimarySessionPreflight on win32 with PowerShell and spaces in paths', () => {
  it('returns agent arguments that round-trip through the PowerShell tokenizer unchanged', () => {
    const spec = specFor()
    const tokenized = tokenizeStartupCommand(spec.agentArgs, 'powershell')
    expect(tokenized.ok).toBe(true)
    if (tokenized.ok) {
      expect(tokenized.tokens).toEqual([
        '--permission-mode',
        'manual',
        '--settings',
        SPACED_PATH,
        '--agents',
        agentsJson()
      ])
      expect(tokenized.spans.some((span) => span.divergesFromShell)).toBe(false)
    }
    expect(spec.shell).toBe('powershell')
  })

  it('builds a launch command that carries --settings and --agents intact and no bypass token', () => {
    const command = launcherCommand(specFor(), 'win32')
    expect(command).toContain(
      `${quoted('--settings', 'powershell')} ${quoted(SPACED_PATH, 'powershell')}`
    )
    expect(command).toContain(
      `${quoted('--agents', 'powershell')} ${quoted(agentsJson(), 'powershell')}`
    )
    expect(command).toContain(
      `${quoted('--permission-mode', 'powershell')} ${quoted('manual', 'powershell')}`
    )
    expect(command).toContain(
      `${quoted('--model', 'powershell')} ${quoted('claude-opus-5-5', 'powershell')}`
    )
    expect(command).toContain(`${quoted('--effort', 'powershell')} ${quoted('max', 'powershell')}`)
    expect(findForbiddenPermissionText(command.replace(/ 'You are the primary.*$/s, ''))).toBeNull()
    expect(command).not.toContain('--dangerously-skip-permissions')
    expect(command).not.toContain('--allow-dangerously-skip-permissions')
    expect(command).not.toContain('dontAsk')
  })

  it('uses acceptEdits for workspace_write', () => {
    const spec = specFor({ access: 'workspace_write' })
    expect(spec.permissionMode).toBe('acceptEdits')
    const command = launcherCommand(spec, 'win32')
    expect(command).toContain(
      `${quoted('--permission-mode', 'powershell')} ${quoted('acceptEdits', 'powershell')}`
    )
  })

  it('reports the probe command it checked, built with a neutral prompt', () => {
    const spec = specFor()
    expect(spec.probeCommand).toContain(quoted(SPACED_PATH, 'powershell'))
    expect(spec.probeCommand).not.toContain('bypass')
  })

  it('keeps a path with an apostrophe whole by doubling it for PowerShell', () => {
    const path = "C:\\Users\\O'Brien\\NASH\\primary-sessions\\run_1-g1.json"
    const spec = specFor({ settingsFilePath: path })
    const tokenized = tokenizeStartupCommand(spec.agentArgs, 'powershell')
    expect(tokenized.ok && tokenized.tokens).toContain(path)
    expect(launcherCommand(spec, 'win32')).toContain(quoted(path, 'powershell'))
  })

  it('refuses a settings path with a backtick, which PowerShell would read as an escape', () => {
    const refusal = refusalFor({
      settingsFilePath: 'C:\\Users\\a`b\\primary-sessions\\run_1-g1.json'
    })
    expect(refusal.code).toBe('autopilot_session_quoting_unsafe')
  })

  it('omits --agents when no subagent is defined', () => {
    const spec = specFor({ agentsJson: null })
    expect(spec.agentArgs).not.toContain('--agents')
    expect(launcherCommand(spec, 'win32')).not.toContain('--agents')
  })

  it('drops a YOLO default from Settings because the app arguments replace the defaults', () => {
    const settings = { agentDefaultArgs: { claude: '--dangerously-skip-permissions' } }
    const spec = specFor({ settings })
    const command = launcherCommand(spec, 'win32', settings)
    expect(command).not.toContain('dangerously')
    expect(command).toContain(quoted('manual', 'powershell'))
  })

  it('does not mutate frozen settings', () => {
    const settings = Object.freeze({ agentCmdOverrides: Object.freeze({ codex: 'c' }) })
    expect(() => runPrimarySessionPreflight(inputFor({ settings }))).not.toThrow()
  })
})

describe('runPrimarySessionPreflight on other shells and platforms', () => {
  it('uses POSIX quoting on win32 when the terminal is Git Bash', () => {
    const settings = { terminalWindowsShell: 'git-bash' }
    const spec = specFor({ settings })
    expect(spec.shell).toBe('posix')
    const command = launcherCommand(spec, 'win32', settings)
    expect(command).toContain(`${quoted('--settings', 'posix')} ${quoted(SPACED_PATH, 'posix')}`)
    expect(command).toContain(quoted(agentsJson(), 'posix'))
  })

  it.each(['linux', 'darwin'] as const)(
    'uses POSIX quoting on %s with spaces in the path',
    (platform) => {
      const path = '/home/test user/.config/NASH App/primary-sessions/run_1-g1.json'
      const spec = specFor({ platform, settingsFilePath: path })
      expect(spec.shell).toBe('posix')
      const command = launcherCommand(spec, platform)
      expect(command).toContain(`${quoted('--settings', 'posix')} ${quoted(path, 'posix')}`)
      expect(command).toContain(quoted(agentsJson(), 'posix'))
    }
  )

  it('keeps an apostrophe in a POSIX path whole', () => {
    const path = "/home/o'brien/NASH/primary-sessions/run_1-g1.json"
    const spec = specFor({ platform: 'linux', settingsFilePath: path })
    const tokenized = tokenizeStartupCommand(spec.agentArgs, 'posix')
    expect(tokenized.ok && tokenized.tokens).toContain(path)
  })

  it('refuses a cmd.exe terminal because its quoting cannot carry the subagent JSON', () => {
    const refusal = refusalFor({ settings: { terminalWindowsShell: 'cmd.exe' } })
    expect(refusal.code).toBe('autopilot_session_unsupported_shell')
  })

  it('refuses a relative settings path, which Claude Code would resolve against the workspace', () => {
    expect(refusalFor({ settingsFilePath: 'primary-sessions\\run_1-g1.json' }).code).toBe(
      'autopilot_session_settings_path_invalid'
    )
    expect(
      refusalFor({ platform: 'linux', settingsFilePath: 'primary-sessions/run_1.json' }).code
    ).toBe('autopilot_session_settings_path_invalid')
  })

  it('refuses a Windows drive path on a POSIX host because it is not absolute there', () => {
    expect(refusalFor({ platform: 'linux' }).code).toBe('autopilot_session_settings_path_invalid')
  })

  it('carries a backtick in a POSIX path literally, since POSIX single quotes keep it', () => {
    const path = '/home/test/a`b/primary-sessions/run_1-g1.json'
    const spec = specFor({ platform: 'linux', settingsFilePath: path })
    const tokenized = tokenizeStartupCommand(spec.agentArgs, 'posix')
    expect(tokenized.ok && tokenized.tokens).toContain(path)
  })

  it('refuses a settings path that contains a line break', () => {
    expect(refusalFor({ platform: 'linux', settingsFilePath: '/tmp/a\nb.json' }).code).toBe(
      'autopilot_session_settings_path_invalid'
    )
  })

  it.each([[''], ['   ']])('refuses the empty settings path %j', (settingsFilePath) => {
    expect(refusalFor({ settingsFilePath }).code).toBe('autopilot_session_settings_path_invalid')
  })
})

describe('runPrimarySessionPreflight startup plan checks', () => {
  const realBuilder: StartupPlanBuilder = buildAgentStartupPlan

  function withPlan(
    change: (plan: NonNullable<ReturnType<StartupPlanBuilder>>) => ReturnType<StartupPlanBuilder>
  ) {
    const builder: StartupPlanBuilder = (args) => {
      const plan = realBuilder(args)
      return plan ? change(plan) : null
    }
    return runPrimarySessionPreflight(inputFor(), builder)
  }

  it('refuses when the startup plan cannot be built', () => {
    const result = runPrimarySessionPreflight(inputFor(), () => null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_startup_plan_unavailable')
    }
  })

  it('accepts the real plan unchanged', () => {
    expect(withPlan((plan) => plan).ok).toBe(true)
  })

  it('refuses a plan whose command gained a dangerously flag', () => {
    const result = withPlan((plan) => ({
      ...plan,
      launchCommand: `${plan.launchCommand} '--dangerously-skip-permissions'`
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_forbidden_arg')
    }
  })

  it('refuses a plan whose command names a second permission mode', () => {
    const result = withPlan((plan) => ({
      ...plan,
      launchCommand: `${plan.launchCommand} '--permission-mode' 'acceptEdits'`
    }))
    expect(result.ok).toBe(false)
  })

  it('refuses a plan whose command lost the settings file argument', () => {
    const result = withPlan((plan) => ({
      ...plan,
      launchCommand: plan.launchCommand.replace(
        quoted('--settings', 'powershell'),
        "'--no-settings'"
      )
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_startup_plan_mismatch')
    }
  })

  it('refuses a plan whose command lost the subagent definitions', () => {
    const result = withPlan((plan) => ({
      ...plan,
      launchCommand: plan.launchCommand.replace(quoted('--agents', 'powershell'), "'--ignored'")
    }))
    expect(result.ok).toBe(false)
  })

  it('refuses a plan that left the prompt for a later keystroke delivery', () => {
    const result = withPlan((plan) => ({ ...plan, followupPrompt: 'late prompt' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_startup_plan_mismatch')
    }
  })

  it('refuses a plan that did not apply the requested model and effort', () => {
    const result = withPlan((plan) => ({ ...plan, sessionOptions: {} }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_startup_plan_mismatch')
    }
  })

  it('refuses a plan for another agent', () => {
    expect(withPlan((plan) => ({ ...plan, agent: 'codex' })).ok).toBe(false)
  })
})

describe('runPrimarySessionPreflight session options', () => {
  it('returns the model and effort as session options and launch preferences', () => {
    const spec = specFor()
    expect(spec.sessionOptions).toEqual({ model: 'claude-opus-5-5', effort: 'max' })
    expect(spec.launchPreferences).toEqual({ model: 'claude-opus-5-5', effort: 'max' })
  })

  it.each([['low'], ['medium'], ['high'], ['xhigh'], ['max']])(
    'applies the effort %s',
    (effort) => {
      const spec = specFor({ effort })
      expect(launcherCommand(spec, 'win32')).toContain(
        `${quoted('--effort', 'powershell')} ${quoted(effort, 'powershell')}`
      )
    }
  )

  it.each([
    ['inherit', 'inherit', 'max'],
    ['an alias', 'opus', 'max'],
    ['a Gemini id', 'gemini-3.8-flash-high', 'high'],
    ['ultra effort', 'claude-opus-5-5', 'ultra'],
    ['none effort', 'claude-opus-5-5', 'none'],
    ['minimal effort', 'claude-opus-5-5', 'minimal'],
    ['inherit effort', 'claude-opus-5-5', 'inherit']
  ])('refuses %s as the coordinator choice', (_label, model, effort) => {
    expect(refusalFor({ model, effort }).code).toBe('autopilot_session_model_invalid')
  })

  it('refuses an access value that is not one of the two postures', () => {
    const stored: PrimarySessionPreflightInput = JSON.parse(
      JSON.stringify({ ...inputFor(), access: 'bypassPermissions' })
    )
    const result = runPrimarySessionPreflight(stored)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_posture_invalid')
    }
  })
})

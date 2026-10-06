import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { decodeClaudeStatusLineRelayRequest } from '../../../shared/claude-statusline-relay-contract'
import {
  preparePrimarySessionLaunch,
  type PrimarySessionLaunchPlanInput
} from './primary-session-launch-plan'
import { PRIMARY_PROMPT_LAUNCH_ARGUMENT_MAX_UNITS } from './primary-session-prompt'
import type { SubagentRouteRowInput } from './primary-session-types'

const USER_DATA = resolve('/fixture/user data')

// FIXTURE_ONLY: a table slice with one subagent row, one Codex row and one inheriting primary row.
const ROWS: readonly SubagentRouteRowInput[] = [
  {
    taskType: 'complex_planning_reasoning',
    executionTarget: 'claude_primary',
    model: 'inherit',
    effort: 'inherit'
  },
  {
    taskType: 'software_engineering',
    executionTarget: 'claude_subagent',
    model: 'claude-sonnet-5-5',
    effort: 'max'
  },
  {
    taskType: 'general_research_analysis',
    executionTarget: 'codex_cli',
    model: 'gpt-6.1-sol',
    effort: 'max'
  }
]

function input(
  overrides: Partial<PrimarySessionLaunchPlanInput> = {}
): PrimarySessionLaunchPlanInput {
  return {
    userDataPath: USER_DATA,
    platform: process.platform,
    cliCommand: 'orca',
    clientSettings: {},
    runId: 'run_plan01',
    generation: 1,
    access: 'read_only',
    deliverableLanguage: null,
    objective: 'Summarize the repository layout.',
    model: 'claude-opus-5-5',
    effort: 'max',
    routeRows: ROWS,
    ...overrides
  }
}

describe('primary session launch plan', () => {
  it('writes the owner-only settings file and returns the checked launch arguments', () => {
    const write = vi.fn(() => true)
    const plan = preparePrimarySessionLaunch(input(), { writeSettings: write })
    expect(plan.ok).toBe(true)
    if (!plan.ok) {
      return
    }
    const settingsPath = join(USER_DATA, 'primary-sessions', 'run_plan01-g1.json')
    expect(write).toHaveBeenCalledWith(
      settingsPath,
      expect.objectContaining({
        permissions: expect.objectContaining({
          disableBypassPermissionsMode: 'disable',
          disableAutoMode: 'disable'
        })
      })
    )
    expect(plan.value).toMatchObject({
      settingsPath,
      permissionMode: 'manual',
      sessionOptions: { model: 'claude-opus-5-5', effort: 'max' },
      subagentNames: ['autopilot-software_engineering']
    })
    expect(plan.value.agentArgs).toContain('--settings')
    expect(plan.value.agentArgs).toContain('--agents')
    expect(plan.value.agentArgs).not.toMatch(/dangerously|bypass|dontask/i)
    expect(plan.value.prompt.text).toContain('Summarize the repository layout.')
  })

  it('chooses the prompt delivery for the platform the session launches on', () => {
    // Why the host platform: the settings path is checked against it, so the fixture cannot fake one.
    const plan = preparePrimarySessionLaunch(input(), { writeSettings: () => true })
    expect(plan.ok && plan.value.prompt.delivery).toBe(
      process.platform === 'win32' ? 'after_start_paste' : 'launch_argument'
    )
  })

  it('pastes a long prompt after start instead of carrying it on argv', () => {
    const plan = preparePrimarySessionLaunch(
      input({ objective: 'a'.repeat(PRIMARY_PROMPT_LAUNCH_ARGUMENT_MAX_UNITS) }),
      { writeSettings: () => true }
    )
    expect(plan.ok && plan.value.prompt.delivery).toBe('after_start_paste')
  })

  it('starts workspace_write sessions in acceptEdits', () => {
    const plan = preparePrimarySessionLaunch(input({ access: 'workspace_write' }), {
      writeSettings: () => true
    })
    expect(plan.ok && plan.value.permissionMode).toBe('acceptEdits')
  })

  it.each([
    [
      'a settings file that is not owner-only',
      input(),
      () => false,
      'autopilot_session_settings_not_owner_only'
    ],
    [
      'a Claude command override',
      input({ clientSettings: { agentCmdOverrides: { claude: 'my-claude' } } }),
      () => true,
      'autopilot_session_command_override'
    ],
    [
      'a non-Claude coordinator model',
      input({ model: 'gpt-6.1-sol' }),
      () => true,
      'autopilot_session_model_invalid'
    ],
    [
      'an unsafe run id',
      input({ runId: '../escape' }),
      () => true,
      'autopilot_session_settings_path_invalid'
    ],
    [
      'an empty objective',
      input({ objective: '   ' }),
      () => true,
      'autopilot_session_objective_invalid'
    ]
  ])('refuses %s', (_label, planInput, writeSettings, code) => {
    const plan = preparePrimarySessionLaunch(planInput, { writeSettings })
    expect(plan).toMatchObject({ ok: false, refusal: { code } })
  })

  describe('status-line relay', () => {
    const relay = {
      nodeRuntimePath: resolve('/fixture/NASH/NASH.exe'),
      relayScriptPath: resolve('/fixture/NASH/relay.js'),
      shellPath: resolve('/fixture/Git/bin/bash.exe'),
      userSettingsPath: resolve('/fixture/home/.claude/settings.json')
    }
    const workspacePath = resolve('/fixture/workspace')

    function asRecord(value: unknown): Record<string, unknown> {
      if (typeof value !== 'object' || value === null) {
        throw new Error('expected an object')
      }
      return Object.fromEntries(Object.entries(value))
    }

    function writtenSettings(
      planInput: PrimarySessionLaunchPlanInput,
      files: Record<string, string> = {}
    ) {
      const write = vi.fn((_path: string, _value: unknown) => true)
      const read = vi.fn((path: string) => files[path] ?? null)
      const plan = preparePrimarySessionLaunch(planInput, {
        writeSettings: write,
        readSettingsText: read
      })
      expect(plan.ok).toBe(true)
      return { settings: asRecord(write.mock.calls[0][1]), read }
    }

    it("adds the relay statusLine that chains the user's own status line", () => {
      const { settings } = writtenSettings(input({ statusLineRelay: relay, workspacePath }), {
        [relay.userSettingsPath]: JSON.stringify({
          statusLine: { type: 'command', command: 'hud', padding: 2 }
        })
      })
      const statusLine = asRecord(settings.statusLine)
      expect(statusLine.type).toBe('command')
      expect(statusLine.padding).toBe(2)
      const argument = String(statusLine.command).split(' ').at(-1) ?? ''
      expect(decodeClaudeStatusLineRelayRequest(argument)).toEqual({
        shell: relay.shellPath,
        command: 'hud'
      })
    })

    it("reads the project's settings from the session workspace", () => {
      const { read } = writtenSettings(input({ statusLineRelay: relay, workspacePath }))
      expect(read.mock.calls.map(([path]) => path)).toEqual([
        join(workspacePath, '.claude', 'settings.local.json'),
        join(workspacePath, '.claude', 'settings.json'),
        relay.userSettingsPath
      ])
    })

    it('leaves the settings without a statusLine when no relay can run', () => {
      const { settings, read } = writtenSettings(input({ statusLineRelay: null, workspacePath }))
      expect(Object.keys(settings)).not.toContain('statusLine')
      expect(read).not.toHaveBeenCalled()
    })

    it('keeps every permission and hook entry when the relay is added', () => {
      const withRelay = writtenSettings(input({ statusLineRelay: relay, workspacePath })).settings
      const without = writtenSettings(input()).settings
      const { statusLine: _relay, ...rest } = withRelay
      expect(rest).toEqual(without)
    })
  })

  it('writes no settings file when the arguments are refused first', () => {
    const write = vi.fn(() => true)
    preparePrimarySessionLaunch(input({ runId: '../escape' }), { writeSettings: write })
    expect(write).not.toHaveBeenCalled()
  })
})

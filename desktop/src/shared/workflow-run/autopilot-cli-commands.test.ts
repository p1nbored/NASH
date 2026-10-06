import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../english-text'
import {
  AUTOPILOT_AGENT_COMMANDS,
  AUTOPILOT_AGENT_COMMAND_USAGE,
  AUTOPILOT_CLI_GROUP,
  AUTOPILOT_HIDDEN_COMMANDS,
  PERMISSION_HOOK_TIMEOUT_SECONDS,
  PERMISSION_RELAY_WAIT_SECONDS,
  autopilotBashAllowRule,
  autopilotCliInvocation,
  isCliCommandName
} from './autopilot-cli-commands'

describe('autopilot CLI command vocabulary', () => {
  it('names exactly the five agent-facing task commands under the orchestration group', () => {
    expect(AUTOPILOT_CLI_GROUP).toBe('orchestration')
    expect([...AUTOPILOT_AGENT_COMMANDS]).toEqual([
      'task-propose',
      'task-start',
      'task-show',
      'task-report',
      'run-complete'
    ])
  })

  it('keeps the permission relay command hidden from the agent vocabulary', () => {
    expect([...AUTOPILOT_HIDDEN_COMMANDS]).toEqual(['permission-request'])
    const agentNames: readonly string[] = AUTOPILOT_AGENT_COMMANDS
    for (const hidden of AUTOPILOT_HIDDEN_COMMANDS) {
      expect(agentNames.includes(hidden)).toBe(false)
    }
  })

  it('builds the invocation prefix from the CLI name, the group and the command', () => {
    expect(autopilotCliInvocation('orca', 'task-propose')).toBe('orca orchestration task-propose')
    expect(autopilotCliInvocation('orca-dev', 'permission-request')).toBe(
      'orca-dev orchestration permission-request'
    )
  })

  it('builds one Bash allow rule per agent command with a trailing wildcard after the subcommand', () => {
    expect(
      AUTOPILOT_AGENT_COMMANDS.map((command) => autopilotBashAllowRule('orca', command))
    ).toEqual([
      'Bash(orca orchestration task-propose *)',
      'Bash(orca orchestration task-start *)',
      'Bash(orca orchestration task-show *)',
      'Bash(orca orchestration task-report *)',
      'Bash(orca orchestration run-complete *)'
    ])
  })

  it.each([
    ['empty', ''],
    ['with a space', 'or ca'],
    ['with a rule terminator', 'orca) Bash(rm -rf *'],
    ['with a shell separator', 'orca; rm'],
    ['with a leading dash', '-orca'],
    ['with a path separator', 'bin/orca'],
    ['with a wildcard', 'or*a']
  ])('refuses a CLI name %s', (_label, name) => {
    expect(isCliCommandName(name)).toBe(false)
    expect(() => autopilotCliInvocation(name, 'task-show')).toThrow(RangeError)
    expect(() => autopilotBashAllowRule(name, 'task-show')).toThrow(RangeError)
  })

  it('accepts the three CLI names the local app can advertise', () => {
    for (const name of ['orca', 'orca-dev', 'orca-ide']) {
      expect(isCliCommandName(name)).toBe(true)
    }
  })

  it('gives every agent command an English usage entry', () => {
    for (const command of AUTOPILOT_AGENT_COMMANDS) {
      const usage = AUTOPILOT_AGENT_COMMAND_USAGE[command]
      expect(isEnglishText(usage.flags)).toBe(true)
      expect(isEnglishText(usage.summary)).toBe(true)
      expect(usage.summary.length).toBeGreaterThan(10)
    }
  })

  it('tells the primary before any start that a writing task starts from its last commit (D-025)', () => {
    const { summary } = AUTOPILOT_AGENT_COMMAND_USAGE['task-start']
    expect(summary).toMatch(/last commit/)
    expect(summary).toMatch(/commit what it needs first/)
  })

  it('takes long text from a file or stdin, never from argv', () => {
    expect(AUTOPILOT_AGENT_COMMAND_USAGE['task-propose'].flags).toContain('--spec-file -')
    expect(AUTOPILOT_AGENT_COMMAND_USAGE['run-complete'].flags).toContain('--summary-file -')
    expect(AUTOPILOT_AGENT_COMMAND_USAGE['task-report'].flags).toContain('--summary-file -')
    for (const command of AUTOPILOT_AGENT_COMMANDS) {
      expect(AUTOPILOT_AGENT_COMMAND_USAGE[command].flags).not.toMatch(
        /--(spec|summary|objective) </
      )
    }
  })

  it('sets the permission hook timeout above the relay wait so the relay answers first', () => {
    expect(PERMISSION_RELAY_WAIT_SECONDS).toBe(240)
    expect(Number.isInteger(PERMISSION_HOOK_TIMEOUT_SECONDS)).toBe(true)
    expect(PERMISSION_HOOK_TIMEOUT_SECONDS).toBeGreaterThan(PERMISSION_RELAY_WAIT_SECONDS)
    expect(PERMISSION_HOOK_TIMEOUT_SECONDS).toBeLessThan(600)
  })
})

import { describe, expect, it } from 'vitest'
import { CLI_COMMAND_NAMES } from '../main/startup/cli-command-names'
import {
  AUTOPILOT_AGENT_COMMANDS,
  AUTOPILOT_CLI_GROUP,
  AUTOPILOT_HIDDEN_COMMANDS
} from '../shared/workflow-run/autopilot-cli-commands'
import { specPaths } from './args'
import { HANDLER_COMMAND_KEYS } from './dispatch'
import { HANDLER_GROUPS } from './handler-group-manifest'
import { COMMAND_SPECS } from './specs'
import { DOT_COMMAND_SPECS } from './specs/dot'
import { ORCHESTRATION_AUTOPILOT_COMMAND_SPECS } from './specs/orchestration-autopilot-specs'
import { ORCHESTRATION_PERMISSION_COMMAND_SPECS } from './specs/orchestration-permission-specs'

// E1 registers the D-016 commands in the one CLI spec table, the handler manifest and the launch
// redirect. The names must be the ones the launch prompt and the hook command spell (A3).

const keyOf = (path: readonly string[]): string => path.join(' ')
const SPEC_KEYS = COMMAND_SPECS.flatMap((spec) => specPaths(spec)).map(keyOf)

describe('the D-016 CLI commands', () => {
  it.each([
    ['task API', ORCHESTRATION_AUTOPILOT_COMMAND_SPECS],
    ['permission hook', ORCHESTRATION_PERMISSION_COMMAND_SPECS],
    ['dot client', DOT_COMMAND_SPECS]
  ] as const)('puts every %s spec in the live spec table once', (_name, specs) => {
    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) {
      expect(COMMAND_SPECS).toContain(spec)
      expect(SPEC_KEYS.filter((key) => key === keyOf(spec.path))).toEqual([keyOf(spec.path)])
    }
  })

  it('routes every registered D-016 command to a handler', () => {
    const commands = [
      ...ORCHESTRATION_AUTOPILOT_COMMAND_SPECS,
      ...ORCHESTRATION_PERMISSION_COMMAND_SPECS,
      ...DOT_COMMAND_SPECS
    ].map((spec) => keyOf(spec.path))
    for (const command of commands) {
      expect(HANDLER_COMMAND_KEYS.has(command), command).toBe(true)
    }
  })

  it('loads each D-016 command from the handler module that defines it', async () => {
    const expected: Readonly<Record<string, readonly string[]>> = {
      'orchestration-autopilot': AUTOPILOT_AGENT_COMMANDS.map(
        (command) => `${AUTOPILOT_CLI_GROUP} ${command}`
      ),
      'orchestration-permission': AUTOPILOT_HIDDEN_COMMANDS.map(
        (command) => `${AUTOPILOT_CLI_GROUP} ${command}`
      ),
      dot: DOT_COMMAND_SPECS.map((spec) => keyOf(spec.path))
    }
    for (const [name, keys] of Object.entries(expected)) {
      const group = HANDLER_GROUPS.find((entry) => entry.name === name)
      expect(group, name).toBeDefined()
      expect([...(group?.keys ?? [])].sort()).toEqual([...keys].sort())
      const loaded = await group?.load()
      for (const key of keys) {
        expect(typeof loaded?.[key], key).toBe('function')
      }
    }
  })

  it('names exactly the commands the launch prompt and the permission hook spell', () => {
    expect(ORCHESTRATION_AUTOPILOT_COMMAND_SPECS.map((spec) => keyOf(spec.path))).toEqual(
      AUTOPILOT_AGENT_COMMANDS.map((command) => `${AUTOPILOT_CLI_GROUP} ${command}`)
    )
    expect(ORCHESTRATION_PERMISSION_COMMAND_SPECS.map((spec) => keyOf(spec.path))).toEqual(
      AUTOPILOT_HIDDEN_COMMANDS.map((command) => `${AUTOPILOT_CLI_GROUP} ${command}`)
    )
  })

  it('keeps the hook command and the dot client out of the help listing', () => {
    for (const spec of [...ORCHESTRATION_PERMISSION_COMMAND_SPECS, ...DOT_COMMAND_SPECS]) {
      expect(spec.hidden, keyOf(spec.path)).toBe(true)
    }
  })

  it('lets the packaged launcher redirect both command families to the CLI', () => {
    expect(CLI_COMMAND_NAMES).toContain('orchestration')
    expect(CLI_COMMAND_NAMES).toContain('dot')
    for (const spec of COMMAND_SPECS) {
      expect(CLI_COMMAND_NAMES, keyOf(spec.path)).toContain(spec.path[0])
    }
  })
})

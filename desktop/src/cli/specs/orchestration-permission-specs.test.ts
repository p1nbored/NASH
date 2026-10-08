import { describe, expect, it } from 'vitest'
import { GLOBAL_FLAGS } from '../args'
import {
  AUTOPILOT_CLI_GROUP,
  AUTOPILOT_HIDDEN_COMMANDS
} from '../../shared/workflow-run/autopilot-cli-commands'
import { ORCHESTRATION_PERMISSION_COMMAND_SPECS } from './orchestration-permission-specs'

describe('orchestration permission command spec', () => {
  it('declares exactly the hidden command the PermissionRequest hook runs', () => {
    expect(
      ORCHESTRATION_PERMISSION_COMMAND_SPECS.filter((spec) => spec.hidden).map((spec) => spec.path)
    ).toEqual(AUTOPILOT_HIDDEN_COMMANDS.map((command) => [AUTOPILOT_CLI_GROUP, command]))
  })

  it('keeps the hook hidden with an explicit provider flag', () => {
    for (const spec of ORCHESTRATION_PERMISSION_COMMAND_SPECS.filter((spec) => spec.hidden)) {
      expect(spec.hidden).toBe(true)
      expect(spec.positionalArgs ?? []).toEqual([])
      expect([...spec.allowedFlags].sort()).toEqual([...GLOBAL_FLAGS, 'provider'].sort())
      expect(spec.aliases ?? []).toEqual([])
    }
  })

  it('says in English that it reads the hook JSON on stdin and is not for agents', () => {
    const [spec] = ORCHESTRATION_PERMISSION_COMMAND_SPECS
    expect(spec?.summary).toMatch(/PermissionRequest hook/)
    expect(spec?.notes?.join(' ')).toMatch(/stdin/)
    expect(spec?.notes?.join(' ')).toMatch(/Not for agents/)
  })
})

import { describe, expect, it } from 'vitest'
import { GLOBAL_FLAGS } from '../args'
import {
  AUTOPILOT_AGENT_COMMAND_USAGE,
  AUTOPILOT_AGENT_COMMANDS,
  AUTOPILOT_CLI_GROUP
} from '../../shared/workflow-run/autopilot-cli-commands'
import { ORCHESTRATION_AUTOPILOT_COMMAND_SPECS } from './orchestration-autopilot-specs'

function specFor(command: string) {
  const spec = ORCHESTRATION_AUTOPILOT_COMMAND_SPECS.find((entry) => entry.path[1] === command)
  if (!spec) {
    throw new Error(`missing spec ${command}`)
  }
  return spec
}

function ownFlags(command: string): string[] {
  return specFor(command)
    .allowedFlags.filter((flag) => !GLOBAL_FLAGS.includes(flag))
    .sort()
}

describe('orchestration autopilot command specs', () => {
  it('declares exactly the five commands the primary session is allowed to run', () => {
    expect(ORCHESTRATION_AUTOPILOT_COMMAND_SPECS.map((spec) => spec.path)).toEqual(
      AUTOPILOT_AGENT_COMMANDS.map((command) => [AUTOPILOT_CLI_GROUP, command])
    )
  })

  it('accepts every flag the launch prompt and the settings file name', () => {
    for (const command of AUTOPILOT_AGENT_COMMANDS) {
      const named = [...AUTOPILOT_AGENT_COMMAND_USAGE[command].flags.matchAll(/--([a-z-]+)/g)]
      for (const [, flag] of named) {
        expect(specFor(command).allowedFlags).toContain(flag)
      }
    }
  })

  it('takes a TaskSpec and summaries only from a file or stdin, never from argv', () => {
    for (const spec of ORCHESTRATION_AUTOPILOT_COMMAND_SPECS) {
      for (const flag of ['spec', 'summary', 'body', 'objective', 'payload']) {
        expect(spec.allowedFlags).not.toContain(flag)
      }
      expect(spec.positionalArgs ?? []).toEqual([])
    }
    expect(ownFlags('task-propose')).toEqual(['retry-request', 'spec-file'])
    expect(ownFlags('task-report')).toEqual([
      'attempt',
      'outcome',
      'retry-request',
      'summary-file',
      'task'
    ])
    expect(ownFlags('run-complete')).toEqual(['retry-request', 'summary-file'])
  })

  it('has no flag that names a caller, a run, a target, a model, an effort or a language', () => {
    const refused = ['from', 'terminal', 'run', 'target', 'model', 'effort', 'language']
    for (const spec of ORCHESTRATION_AUTOPILOT_COMMAND_SPECS) {
      for (const flag of refused) {
        expect(spec.allowedFlags).not.toContain(flag)
      }
      expect(spec.identityFlagRoles ?? {}).toEqual({})
    }
    expect(ownFlags('task-start')).toEqual(['retry-request', 'task'])
    expect(ownFlags('task-show')).toEqual(['task', 'wait'])
  })

  it('is visible, English and says where long text comes from', () => {
    for (const spec of ORCHESTRATION_AUTOPILOT_COMMAND_SPECS) {
      expect(spec.hidden ?? false).toBe(false)
      expect(spec.summary).toMatch(/^[A-Z][A-Za-z ,'-]+$/)
      expect(spec.usage.startsWith(`orca ${spec.path.join(' ')}`)).toBe(true)
    }
    expect(specFor('task-propose').notes?.join(' ')).toMatch(/stdin/)
    expect(specFor('task-report').notes?.join(' ')).toMatch(/stdin/)
  })

  it('says English is preferred for a TaskSpec, not checked (D-027)', () => {
    const notes = specFor('task-propose').notes?.join(' ') ?? ''
    expect(notes).toMatch(/English is preferred, not checked/)
    expect(notes).not.toMatch(/one English JSON object/)
  })
})

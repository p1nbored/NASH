import { describe, expect, it } from 'vitest'
import { AUTOPILOT_AGENT_COMMAND_USAGE } from './autopilot-cli-commands'

// E1 follow-up for D1: the usage the launch prompt lists names the optional flags the commands take,
// so the primary can report a failed attempt and wait for a task without guessing a flag.

describe('the task command usage in the launch prompt', () => {
  it('lists the optional outcome of task-report', () => {
    expect(AUTOPILOT_AGENT_COMMAND_USAGE['task-report'].flags).toContain(
      '[--outcome <succeeded|failed>]'
    )
  })

  it('lists the optional wait of task-show', () => {
    expect(AUTOPILOT_AGENT_COMMAND_USAGE['task-show'].flags).toContain('[--wait]')
  })

  it('keeps the required report flags and the stdin summary', () => {
    expect(AUTOPILOT_AGENT_COMMAND_USAGE['task-report'].flags).toMatch(
      /^--task <task_id> --attempt <attempt_id> --summary-file - /
    )
  })
})

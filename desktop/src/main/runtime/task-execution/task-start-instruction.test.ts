// FIXTURE_ONLY: synthetic ids; the instructions are checked as text only.
import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../../../shared/english-text'
import { inSessionInstruction } from './task-start-instruction'

const IDS = { taskId: 'task_0123456789ab', dispatchId: 'ctx_0123456789ab', cliCommand: 'orca' }
const REPORT =
  '`orca orchestration task-report --task task_0123456789ab --attempt ctx_0123456789ab --summary-file - --json`'

describe('inSessionInstruction', () => {
  it('names exactly one subagent and puts the attempt id on the first line of its prompt', () => {
    const text = inSessionInstruction({
      ...IDS,
      target: 'claude_subagent',
      taskType: 'software_engineering',
      workflowName: null
    })
    expect(isEnglishText(text)).toBe(true)
    expect(text).toContain('`autopilot-software_engineering`')
    expect(text).toContain('`Attempt: ctx_0123456789ab`')
    expect(text).toMatch(/do not start any other agent/i)
    expect(text).toContain(REPORT)
  })

  it('names the workflow of a workflow attempt', () => {
    const text = inSessionInstruction({
      ...IDS,
      target: 'claude_workflow',
      taskType: 'configured_project_workflow',
      workflowName: 'release-notes'
    })
    expect(isEnglishText(text)).toBe(true)
    expect(text).toContain('`release-notes`')
    expect(text).toContain(REPORT)
  })

  it('asks the primary to do its own attempt itself', () => {
    const text = inSessionInstruction({
      ...IDS,
      target: 'claude_primary',
      taskType: 'complex_planning_reasoning',
      workflowName: null
    })
    expect(isEnglishText(text)).toBe(true)
    expect(text).toMatch(/yourself/)
    expect(text).toContain(REPORT)
  })

  it('never names a model or an effort: the subagent definition carries them', () => {
    const text = inSessionInstruction({
      ...IDS,
      target: 'claude_subagent',
      taskType: 'high_quality_writing',
      workflowName: null
    })
    expect(text).not.toMatch(/claude-|opus|sonnet|effort/i)
  })

  it('asks the primary to do a task it keeps without any task type', () => {
    const text = inSessionInstruction({
      ...IDS,
      target: 'claude_primary',
      taskType: null,
      workflowName: null
    })
    expect(text).toMatch(/yourself/)
    expect(() =>
      inSessionInstruction({
        ...IDS,
        target: 'claude_subagent',
        taskType: null,
        workflowName: null
      })
    ).toThrow()
  })

  it('refuses a CLI name that is not one bare word', () => {
    expect(() =>
      inSessionInstruction({
        ...IDS,
        cliCommand: 'orca && x',
        target: 'claude_primary',
        taskType: 'complex_planning_reasoning',
        workflowName: null
      })
    ).toThrow()
  })
})

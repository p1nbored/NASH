import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../../../shared/english-text'
import { inSessionInstruction, type InSessionTarget } from './task-start-instruction'

// E1 follow-up for D1: without the flag a failed in-session attempt is reported as a claim and only
// the validators catch it, so the instruction says how to report a failure.

const REPORT =
  '`orca orchestration task-report --task task_0123456789ab --attempt ctx_0123456789ab --summary-file - --json`'

const INPUTS: readonly {
  target: InSessionTarget
  taskType: string | null
  workflowName: string | null
}[] = [
  { target: 'claude_subagent', taskType: 'software_engineering', workflowName: null },
  { target: 'claude_workflow', taskType: null, workflowName: 'release-notes' },
  { target: 'claude_primary', taskType: null, workflowName: null }
]

describe('the in-session instruction and a failed attempt', () => {
  it.each(INPUTS)('tells the $target attempt to add --outcome failed when it failed', (input) => {
    const text = inSessionInstruction({
      taskId: 'task_0123456789ab',
      dispatchId: 'ctx_0123456789ab',
      cliCommand: 'orca',
      ...input
    })
    expect(text).toContain(REPORT)
    expect(text).toContain('`--outcome failed`')
    expect(text.indexOf('`--outcome failed`')).toBeGreaterThan(text.indexOf(REPORT))
    expect(isEnglishText(text)).toBe(true)
  })
})

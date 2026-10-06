// FIXTURE_ONLY: synthetic ids; the instructions are checked as text only.
import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../../../shared/english-text'
import { inSessionInstruction, processInstruction } from './task-start-instruction'

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

describe('processInstruction', () => {
  it.each([
    ['codex_cli', 'Codex CLI'],
    ['agy_cli', 'agy CLI']
  ] as const)(
    'tells the primary that the %s runs it and where the result arrives',
    (kind, name) => {
      const text = processInstruction({ ...IDS, kind, placement: { mode: 'run_workspace' } })
      expect(isEnglishText(text)).toBe(true)
      expect(text).toContain(name)
      expect(text).toMatch(/do not do this task yourself/i)
      expect(text).toContain('`orca orchestration task-show --task task_0123456789ab --json`')
      expect(text).not.toMatch(/worktree|commit/i)
    }
  )

  const WORKTREE = {
    worktreeId: 'fixture-repo::C:/fixture/workspaces/nash-task-1',
    branch: 'nash-task-1',
    path: 'C:/fixture/workspaces/nash-task-1',
    baseCommit: '0123456789abcdef0123456789abcdef01234567'
  }

  it('names the own worktree and branch, and says each writing task starts from the last commit (D-025)', () => {
    const text = processInstruction({
      ...IDS,
      kind: 'codex_cli',
      placement: { mode: 'own_worktree', worktree: WORKTREE }
    })
    expect(isEnglishText(text)).toBe(true)
    expect(text).toContain('`nash-task-1`')
    expect(text).toContain('`C:/fixture/workspaces/nash-task-1`')
    expect(text).toContain('`0123456789ab`')
    expect(text).toMatch(/last commit/)
    expect(text).toMatch(/commit what a task needs before you start it/i)
  })

  it('says a folder workspace task writes in the folder itself, not kept apart (D-025)', () => {
    const text = processInstruction({ ...IDS, kind: 'agy_cli', placement: { mode: 'folder' } })
    expect(isEnglishText(text)).toBe(true)
    expect(text).toMatch(/folder/)
    expect(text).toMatch(/not kept apart/)
  })

  it('leaves out a worktree path or branch it cannot quote safely', () => {
    const text = processInstruction({
      ...IDS,
      kind: 'codex_cli',
      placement: { mode: 'own_worktree', worktree: { ...WORKTREE, branch: 'odd`branch' } }
    })
    expect(text).not.toContain('odd`branch')
    expect(text).toMatch(/its own worktree/)
    expect(text).toMatch(/last commit/)
  })
})

import { describe, expect, it } from 'vitest'
import {
  WorkbenchRunTasksParams,
  WorkbenchRunTasksResultSchema,
  WorkbenchTaskSourceSchema
} from './workbench-task-window-params'
describe('workbench task list contract', () => {
  it('takes one run id and nothing else', () => {
    expect(WorkbenchRunTasksParams.parse({ runId: 'run_fixture01' })).toEqual({
      runId: 'run_fixture01'
    })
    expect(WorkbenchRunTasksParams.safeParse({ runId: 'run with spaces' }).success).toBe(false)
    expect(WorkbenchRunTasksParams.safeParse({ runId: 'run_fixture01', all: true }).success).toBe(
      false
    )
  })
  it('accepts current session or terminal references', () => {
    expect(
      WorkbenchTaskSourceSchema.parse({ kind: 'terminal', terminal: 'terminal-fixture' })
    ).toEqual({ kind: 'terminal', terminal: 'terminal-fixture' })
    expect(
      WorkbenchTaskSourceSchema.parse({
        kind: 'session',
        worktreeId: 'worktree-fixture',
        sessionId: 'session-fixture',
        agent: 'codex'
      }).kind
    ).toBe('session')
    expect(
      WorkbenchTaskSourceSchema.safeParse({ kind: 'file', path: 'transcript.jsonl' }).success
    ).toBe(false)
  })
  it('keeps unknown status labels and drops obsolete file metadata', () => {
    const parsed = WorkbenchRunTasksResultSchema.parse({
      tasks: [
        {
          taskId: 'task_fixture',
          title: null,
          executorKind: 'future_executor',
          attempts: [
            {
              dispatchId: 'ctx_fixture',
              state: 'future_state',
              startedAt: '2026-10-05T18:00:00.000Z',
              settledAt: null,
              source: null,
              hasTranscript: true
            }
          ]
        }
      ]
    })
    expect(parsed.tasks[0].attempts[0].state).toBe('future_state')
    expect(parsed.tasks[0].attempts[0]).not.toHaveProperty('hasTranscript')
  })
})

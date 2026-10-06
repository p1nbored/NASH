import { describe, expect, it } from 'vitest'
import {
  AUTOPILOT_TASK_PHASES,
  AutopilotTaskViewSchema,
  RunCompleteResultSchema,
  TaskShowResultSchema,
  TaskStartResultSchema
} from './orchestration-autopilot-views'

const VIEW = {
  taskId: 'task_1',
  runId: 'run_1',
  title: null,
  status: 'ready',
  phase: 'ready',
  waitable: false,
  classification: {
    outcome: 'classified',
    needsDelegation: true,
    taskType: 'software_engineering',
    detail: null
  },
  route: { status: 'available', target: 'claude_subagent', delegated: true, reasons: [] },
  attempt: null,
  validation: null,
  next: 'Start the task with `orca orchestration task-start --task task_1 --json`.'
}

describe('orchestration autopilot views', () => {
  it('parses a task view and refuses an unknown key', () => {
    expect(AutopilotTaskViewSchema.parse(VIEW)).toEqual(VIEW)
    expect(AutopilotTaskViewSchema.safeParse({ ...VIEW, model: 'x' }).success).toBe(false)
  })

  it('names no model or effort anywhere in a route view', () => {
    const route = { ...VIEW.route, model: 'claude-sonnet-5-5' }
    expect(AutopilotTaskViewSchema.safeParse({ ...VIEW, route }).success).toBe(false)
  })

  it('marks an executor result as untrusted and allows no result', () => {
    const result = {
      state: 'ok',
      text: 'Report body',
      truncated: false,
      secretsMasked: false,
      bytes: 11,
      sha256: '0'.repeat(64),
      untrusted: true
    }
    expect(TaskShowResultSchema.parse({ task: VIEW, result }).result).toEqual(result)
    expect(TaskShowResultSchema.parse({ task: VIEW, result: null }).result).toBeNull()
    expect(
      TaskShowResultSchema.safeParse({ task: VIEW, result: { ...result, untrusted: false } })
        .success
    ).toBe(false)
    expect(
      TaskShowResultSchema.parse({ task: VIEW, result: { state: 'changed', untrusted: true } })
        .result
    ).toEqual({ state: 'changed', untrusted: true })
  })

  it('carries the task-start view of the execution package', () => {
    const attempt = {
      taskId: 'task_1',
      dispatchId: 'ctx_1',
      routeId: 'route_1',
      target: 'codex_cli',
      delegated: true,
      runsIn: 'process',
      taskStatus: 'dispatched',
      workerState: 'ready',
      instruction: 'Attempt `ctx_1` of task `task_1` runs in the Codex CLI as an app process.'
    }
    expect(TaskStartResultSchema.parse({ attempt })).toEqual({ attempt })
  })

  it('lists the phases a primary can act on', () => {
    expect(AUTOPILOT_TASK_PHASES).toEqual([
      'classifying',
      'waiting_for_dependencies',
      'ready',
      'running',
      'validating',
      'awaiting_decision',
      'needs_attention',
      'completed',
      'failed'
    ])
    expect(
      RunCompleteResultSchema.parse({
        runId: 'run_1',
        status: 'completed',
        completedTasks: 2,
        failedTasks: 1,
        summaryMessageId: 'msg_1'
      }).status
    ).toBe('completed')
  })
})

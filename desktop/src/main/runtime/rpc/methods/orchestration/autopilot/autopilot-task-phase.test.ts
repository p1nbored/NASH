import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../../../../../../shared/english-text'
import { AutopilotTaskViewSchema } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import { splitVerbatimSpans } from '../../../../../../shared/verbatim-spans'
import { describeAutopilotTask, type AutopilotTaskSnapshot } from './autopilot-task-phase'

const CLASSIFIED: AutopilotTaskSnapshot['classification'] = {
  outcome: 'classified',
  needsDelegation: true,
  taskType: 'software_engineering',
  detail: null
}
const AVAILABLE: AutopilotTaskSnapshot['route'] = {
  status: 'available',
  target: 'claude_subagent',
  reasons: []
}
const NOT_DELEGATED: AutopilotTaskSnapshot['route'] = {
  status: 'not_delegated',
  target: null,
  reasons: []
}

function snapshot(overrides: Partial<AutopilotTaskSnapshot> = {}): AutopilotTaskSnapshot {
  return {
    taskId: 'task_1',
    runId: 'run_1',
    title: null,
    status: 'ready',
    classifying: false,
    classification: CLASSIFIED,
    route: AVAILABLE,
    attempt: null,
    validation: null,
    ...overrides
  }
}

function attempt(runsIn: 'session' | 'process', stage: string) {
  return { attemptId: 'ctx_1', runsIn, dispatchStatus: 'dispatched', workerState: 'ready', stage }
}

function describe1(overrides: Partial<AutopilotTaskSnapshot>) {
  return describeAutopilotTask(snapshot(overrides), 'nash')
}

describe('describeAutopilotTask', () => {
  it.each([
    ['classifying', { classification: null, route: null, classifying: true }, true],
    ['needs_attention', { classification: null, route: null }, false],
    ['ready', {}, false],
    ['ready', { route: NOT_DELEGATED }, false],
    ['needs_attention', { route: null }, false],
    ['waiting_for_dependencies', { status: 'pending' }, false],
    ['running', { status: 'dispatched', attempt: attempt('process', 'executor_running') }, true],
    ['running', { status: 'dispatched', attempt: attempt('session', 'executor_running') }, false],
    ['validating', { status: 'blocked', attempt: attempt('session', 'validation_pending') }, true],
    [
      'awaiting_decision',
      { status: 'blocked', attempt: attempt('process', 'validation_inconclusive') },
      false
    ],
    [
      'needs_attention',
      { status: 'blocked', attempt: attempt('process', 'start_outcome_unknown') },
      false
    ],
    ['completed', { status: 'completed' }, false],
    ['failed', { status: 'failed' }, false]
  ] satisfies [string, Partial<AutopilotTaskSnapshot>, boolean][])(
    'reads %s for %j',
    (phase, overrides, waitable) => {
      const view = describe1(overrides)
      expect(view.phase).toBe(phase)
      expect(view.waitable).toBe(waitable)
      expect(AutopilotTaskViewSchema.parse(view)).toEqual(view)
    }
  )

  it('tells the primary to start a routed task with the exact command', () => {
    expect(describe1({}).next).toContain('`nash orchestration task-start --task task_1 --json`')
  })

  it('names the blocker of a task Clef could not classify', () => {
    const view = describe1({
      classification: {
        outcome: 'blocked',
        needsDelegation: null,
        taskType: null,
        detail: 'non_english_objective'
      },
      route: null
    })
    expect(view.phase).toBe('needs_attention')
    expect(view.next).toContain('non_english_objective')
  })

  it('says an unavailable route is never substituted', () => {
    const view = describe1({
      route: { status: 'unavailable', target: 'codex_cli', reasons: ['cli_missing'] }
    })
    expect(view.phase).toBe('needs_attention')
    expect(view.next).toContain('cli_missing')
    expect(view.next).toContain('Nothing is substituted')
    expect(view.route).toEqual({
      status: 'unavailable',
      target: 'codex_cli',
      delegated: true,
      reasons: ['cli_missing']
    })
  })

  it('gives an in-session attempt the report command with its attempt id', () => {
    const view = describe1({
      status: 'dispatched',
      attempt: attempt('session', 'executor_running')
    })
    expect(view.next).toContain(
      '`nash orchestration task-report --task task_1 --attempt ctx_1 --summary-file - --json`'
    )
  })

  it('points a waiting phase at task-show --wait', () => {
    const view = describe1({ status: 'blocked', attempt: attempt('process', 'validation_pending') })
    expect(view.next).toContain('`nash orchestration task-show --task task_1 --wait --json`')
  })

  it('never lets the primary decide an inconclusive validation', () => {
    const view = describe1({
      status: 'blocked',
      attempt: attempt('process', 'validation_inconclusive')
    })
    expect(view.next).toMatch(/user or dot decides/)
  })

  it('writes every next step in English', () => {
    const cases: Partial<AutopilotTaskSnapshot>[] = [
      {},
      { classification: null, route: null, classifying: true },
      { status: 'pending' },
      { status: 'failed' },
      { status: 'completed' },
      { status: 'dispatched', attempt: attempt('process', 'executor_running') }
    ]
    for (const overrides of cases) {
      const split = splitVerbatimSpans(describe1(overrides).next)
      expect(split.ok && isEnglishText(split.prose)).toBe(true)
    }
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getWorkflowRunStore } from './workflow-run-store'
import { getTaskSpecStore, type TaskProposalInput } from './task-spec-store'
import {
  FIXTURE_OBJECTIVE,
  createAppRunHarness,
  seedTask,
  specInput,
  type AppRunHarness
} from './app-attempt.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

// FIXTURE_ONLY: the secret-shaped value below is synthetic and matches no real credential.
const FAKE_SECRET = `sk-${'x'.repeat(24)}`

describe('task proposal: the Orca task and its TaskSpec, together', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const store = () => getTaskSpecStore(harness.owner)
  const count = (table: string) =>
    Number(harness.owner.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)

  const proposal = (overrides: Partial<TaskProposalInput> = {}): TaskProposalInput => {
    const { taskId: _taskId, ...spec } = specInput('unused', harness.runId)
    return { ...spec, objective: FIXTURE_OBJECTIVE, ...overrides }
  }

  it('creates a ready Orca task and its TaskSpec in one step', () => {
    const { taskId, record } = store().propose(proposal())
    expect(harness.owner.getTask(taskId)).toMatchObject({
      id: taskId,
      run_id: harness.runId,
      spec: FIXTURE_OBJECTIVE,
      status: 'ready'
    })
    expect(record).toMatchObject({ taskId, runId: harness.runId, orphaned: false })
    expect(store().get(taskId)).toEqual(record)
  })

  it('keeps an objective and a title past the old 8,000 and 200 character bounds (D-027)', () => {
    const objective = `Summarize the layout. ${'More detail. '.repeat(1_000)}`
    const taskTitle = `Layout ${'t'.repeat(400)}`
    const { taskId } = store().propose(proposal({ objective, taskTitle }))
    const task = harness.owner.getTask(taskId)
    expect(task?.spec).toBe(objective)
    // Orca shortens a long title for display; the app no longer refuses it.
    expect(task?.task_title?.startsWith('Layout ttt')).toBe(true)
  })

  it('records the title, the dependencies, the parent and who proposed it in Orca', () => {
    const first = seedTask(harness)
    const { taskId } = store().propose(
      proposal({
        taskTitle: 'Summarize layout',
        deps: [first.taskId],
        parentId: first.taskId,
        createdBy: { terminalHandle: 'term_primary', paneKey: 'pane_primary:1', runGeneration: 1 }
      })
    )
    expect(harness.owner.getTask(taskId)).toMatchObject({
      task_title: 'Summarize layout',
      parent_id: first.taskId,
      status: 'pending',
      created_by_terminal_handle: 'term_primary',
      created_by_pane_key: 'pane_primary:1',
      created_by_run_generation: 1
    })
    expect(JSON.parse(harness.owner.getTask(taskId)?.deps ?? '')).toEqual([first.taskId])
  })

  it('leaves no Orca task behind when the TaskSpec cannot be written', () => {
    harness.owner.db.exec(
      `CREATE TRIGGER fixture_fail_spec BEFORE INSERT ON task_specs
         BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`
    )
    expect(() => store().propose(proposal())).toThrow('fixture failure')
    expect(count('tasks')).toBe(0)
    expect(count('task_specs')).toBe(0)
  })

  it('refuses dependencies and parents from another run, and creates nothing', () => {
    const other = harness.owner.createRun({
      objective: 'Another run.',
      coordinatorHandle: null,
      coordinatorPaneKey: null
    })
    const foreign = harness.owner.createTask({ spec: 'Another task.', runId: other.id })
    for (const overrides of [
      { deps: [foreign.id] },
      { parentId: foreign.id },
      { deps: ['task_unknown'] }
    ]) {
      expect(errorCodeOf(() => store().propose(proposal(overrides)))).toBe(
        'autopilot_task_not_found'
      )
    }
    expect(count('tasks')).toBe(1)
    expect(count('task_specs')).toBe(0)
  })

  it('refuses a run that is unknown or no longer active, and creates nothing', () => {
    expect(errorCodeOf(() => store().propose(proposal({ runId: 'run_unknown' })))).toBe(
      'autopilot_run_not_found'
    )
    getWorkflowRunStore(harness.owner).transition({
      runId: harness.runId,
      from: 'active',
      to: 'canceled',
      expectedRevision: 2,
      reason: 'user_canceled',
      timestamp: fixtureTime(6)
    })
    expect(errorCodeOf(() => store().propose(proposal()))).toBe('autopilot_run_not_live')
    expect(count('tasks')).toBe(0)
  })

  it('stores secret-shaped and control-character text as written (D-027 restriction 6)', () => {
    const objective = `Log in with ${FAKE_SECRET}.\u0007`
    const created = store().propose(
      proposal({ objective, acceptanceCriteria: [`Use ${FAKE_SECRET}.`] })
    )
    expect(harness.owner.getTask(created.taskId)?.spec).toBe(objective)
    expect(created.record.acceptanceCriteria).toEqual([`Use ${FAKE_SECRET}.`])
  })

  it('refuses a malformed proposal and unknown keys', () => {
    const bad: Record<string, unknown>[] = [
      { ...proposal(), objective: '' },
      { ...proposal(), deps: 'task_1' },
      { ...proposal(), taskTitle: '' },
      { ...proposal(), taskId: 'task_chosen_by_caller' },
      { ...proposal(), extra: true }
    ]
    for (const input of bad) {
      expect(errorCodeOf(() => store().propose(input as never))).toBe('autopilot_invalid_input')
    }
    expect(count('tasks')).toBe(0)
  })

  it('opens its own transaction and refuses a connection that is already in one', () => {
    harness.owner.db.exec('BEGIN IMMEDIATE')
    try {
      expect(errorCodeOf(() => store().propose(proposal()))).toBe(
        'autopilot_transaction_unavailable'
      )
    } finally {
      harness.owner.db.exec('ROLLBACK')
    }
    expect(count('tasks')).toBe(0)
  })
})

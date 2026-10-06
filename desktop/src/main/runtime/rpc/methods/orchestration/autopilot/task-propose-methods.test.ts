import { afterEach, describe, expect, it } from 'vitest'
import {
  AUTOPILOT_TASK_SPEC_MAX_BYTES,
  TaskProposeParams,
  type AutopilotTaskSpec
} from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import { TaskProposeResultSchema } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import { getTaskSpecStore } from '../../../../orchestration/db/task-spec-store'
import { AUTOPILOT_TASK_API_ERROR_CODES } from './autopilot-task-api'
import {
  FIXTURE_SPEC,
  PRIMARY_HANDLE,
  PRIMARY_PANE,
  createTaskApiHarness,
  type TaskApiHarness
} from './autopilot-task-api.test-fixture'
import { TASK_PROPOSE_METHOD } from './task-propose-methods'

const SPEC_REFUSED = AUTOPILOT_TASK_API_ERROR_CODES.specRefused

describe('orchestration.taskPropose', () => {
  let harness: TaskApiHarness | undefined

  afterEach(() => {
    harness?.close()
    harness = undefined
  })

  function propose(spec: AutopilotTaskSpec) {
    const current = harness
    if (!current) {
      throw new Error('no harness')
    }
    return Promise.resolve().then(() =>
      TASK_PROPOSE_METHOD.handler(TaskProposeParams.parse({ spec }), current.context)
    )
  }

  function taskCount(): number {
    return harness?.db.listTasks({ runId: harness.runId }).length ?? 0
  }

  it('is the strict-params method orchestration.taskPropose', () => {
    expect(TASK_PROPOSE_METHOD.name).toBe('orchestration.taskPropose')
    expect(TASK_PROPOSE_METHOD.params).toBe(TaskProposeParams)
  })

  it('creates the Orca task and its TaskSpec in the caller run, then starts Clef', async () => {
    harness = createTaskApiHarness()
    const result = TaskProposeResultSchema.parse(await propose(FIXTURE_SPEC))
    const { taskId } = result.task
    const task = harness.db.getTask(taskId)
    expect(task).toMatchObject({
      run_id: harness.runId,
      spec: FIXTURE_SPEC.objective,
      status: 'ready',
      created_by_terminal_handle: PRIMARY_HANDLE,
      created_by_pane_key: PRIMARY_PANE,
      created_by_process_incarnation: `incarnation_${harness.runId}`
    })
    expect(getTaskSpecStore(harness.db).get(taskId)).toMatchObject({
      runId: harness.runId,
      acceptanceCriteria: FIXTURE_SPEC.acceptanceCriteria,
      machineChecks: FIXTURE_SPEC.machineChecks,
      accessNeed: 'read_only',
      isolationNeed: 'none',
      constraints: [],
      workflowName: null,
      dataClass: 'agent_task_spec'
    })
    expect(harness.classifier.classified).toEqual([taskId])
    expect(result.task).toMatchObject({ phase: 'classifying', waitable: true })
  })

  it('accepts a TaskSpec with no machine checks: its process check or report validates it later', async () => {
    harness = createTaskApiHarness()
    const { machineChecks: _unused, ...spec } = FIXTURE_SPEC
    await expect(propose(spec)).resolves.toBeDefined()
    expect(taskCount()).toBe(1)
  })

  it('accepts any language, no acceptance criteria and long text (D-027)', async () => {
    harness = createTaskApiHarness()
    const spec: AutopilotTaskSpec = {
      objective: `Опишите структуру папки. ${'Подробно. '.repeat(1_000)}`,
      constraints: Array.from({ length: 33 }, (_, index) => `${index} ${'制約。'.repeat(700)}`)
    }
    const result = TaskProposeResultSchema.parse(await propose(spec))
    expect(harness.db.getTask(result.task.taskId)?.spec).toBe(spec.objective)
    expect(getTaskSpecStore(harness.db).get(result.task.taskId)).toMatchObject({
      acceptanceCriteria: [],
      constraints: spec.constraints,
      review: null
    })
  })

  it('stores an explicit request for a model review', async () => {
    harness = createTaskApiHarness()
    const result = TaskProposeResultSchema.parse(
      await propose({ ...FIXTURE_SPEC, review: 'model' })
    )
    expect(getTaskSpecStore(harness.db).get(result.task.taskId)?.review).toBe('model')
  })

  it('refuses a TaskSpec over the 256 KiB technical ceiling and writes nothing', async () => {
    harness = createTaskApiHarness()
    const objective = 'x'.repeat(AUTOPILOT_TASK_SPEC_MAX_BYTES)
    await expect(propose({ ...FIXTURE_SPEC, objective })).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.specTooLarge,
      data: { maxBytes: AUTOPILOT_TASK_SPEC_MAX_BYTES, effectsApplied: false }
    })
    expect(taskCount()).toBe(0)
    expect(harness.classifier.classified).toEqual([])
  })

  it('stores control characters and credential shapes in TaskSpec texts unchanged (D-027 restriction 6)', async () => {
    harness = createTaskApiHarness()
    const objective = 'Line one‮ line two\u0007 and \u001b[201~ three.'
    const criterion = 'The key sk-0123456789abcdef0123456789abcdef is gone.'
    const result = TaskProposeResultSchema.parse(
      await propose({ ...FIXTURE_SPEC, objective, acceptanceCriteria: [criterion] })
    )
    expect(harness.db.getTask(result.task.taskId)?.spec).toBe(objective)
    expect(getTaskSpecStore(harness.db).get(result.task.taskId)?.acceptanceCriteria).toEqual([
      criterion
    ])
  })

  it.each([
    ['machineChecks.0', 'unknown_kind', { machineChecks: [{ kind: 'tests_pass' }] }],
    ['machineChecks.0', 'invalid_parameters', { machineChecks: [{ kind: 'artifact_exists' }] }]
  ] satisfies [string, string, Partial<AutopilotTaskSpec>][])(
    'refuses %s (%s) and writes nothing',
    async (field, reason, overrides) => {
      harness = createTaskApiHarness()
      await expect(propose({ ...FIXTURE_SPEC, ...overrides })).rejects.toMatchObject({
        code: SPEC_REFUSED,
        data: { field, reason, effectsApplied: false }
      })
      expect(taskCount()).toBe(0)
      expect(harness.classifier.classified).toEqual([])
    }
  )

  it('accepts a TaskSpec written with Windows line endings and stores it with LF (M6)', async () => {
    harness = createTaskApiHarness()
    const result = TaskProposeResultSchema.parse(
      await propose({ ...FIXTURE_SPEC, objective: 'Line one.\r\nLine two.\rLine three.' })
    )
    expect(harness.db.getTask(result.task.taskId)?.spec).toBe('Line one.\nLine two.\nLine three.')
  })

  it('accepts other control characters at the params, and keeps a title to one line (D-027)', () => {
    harness = createTaskApiHarness()
    const spec = { ...FIXTURE_SPEC, objective: 'Line one\u001b[201~ line two.' }
    expect(TaskProposeParams.safeParse({ spec }).success).toBe(true)
    expect(TaskProposeParams.safeParse({ spec: { ...spec, title: 'Bell\u0007' } }).success).toBe(
      true
    )
    const twoLines = TaskProposeParams.safeParse({ spec: { ...spec, title: 'One\nTwo' } })
    expect(twoLines.success).toBe(false)
    expect(twoLines.error?.issues[0]?.message).toContain('one line')
    expect(taskCount()).toBe(0)
  })

  it('keeps names quoted in any script byte-exact', async () => {
    harness = createTaskApiHarness()
    const objective = 'Summarize the file `設計書.md` in English.'
    const result = TaskProposeResultSchema.parse(await propose({ ...FIXTURE_SPEC, objective }))
    expect(harness.db.getTask(result.task.taskId)?.spec).toBe(objective)
  })

  it('refuses before writing while the classifier is not running', async () => {
    harness = createTaskApiHarness()
    harness.setClassifier(null)
    await expect(propose(FIXTURE_SPEC)).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.unavailable
    })
    expect(taskCount()).toBe(0)
  })

  it('keeps the task when starting Clef throws, and says it is not classified', async () => {
    harness = createTaskApiHarness()
    harness.classifier.classify = () => {
      throw new Error('boom')
    }
    const result = TaskProposeResultSchema.parse(await propose(FIXTURE_SPEC))
    expect(result.task.phase).toBe('needs_attention')
    expect(harness.ports.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'classify_failed', taskId: result.task.taskId })
    )
  })

  it('refuses a dependency on a task of another run', async () => {
    harness = createTaskApiHarness()
    const foreign = harness.db.createRun({
      objective: 'Other run.',
      coordinatorHandle: null,
      coordinatorPaneKey: null
    })
    const other = harness.db.createTask({ spec: 'Other task.', runId: foreign.id })
    await expect(propose({ ...FIXTURE_SPEC, deps: [other.id] })).rejects.toMatchObject({
      code: 'autopilot_task_not_found'
    })
    expect(taskCount()).toBe(0)
  })

  it('refuses outside an active run and for any other caller', async () => {
    harness = createTaskApiHarness({ runStatus: 'completing' })
    await expect(propose(FIXTURE_SPEC)).rejects.toMatchObject({ code: 'autopilot_run_not_live' })
    harness.close()
    harness = createTaskApiHarness()
    harness.setAuthority(null)
    await expect(propose(FIXTURE_SPEC)).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.callerRefused
    })
    expect(taskCount()).toBe(0)
  })
})

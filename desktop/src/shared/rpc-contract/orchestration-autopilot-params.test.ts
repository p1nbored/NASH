import { describe, expect, it } from 'vitest'
import {
  AUTOPILOT_BASH_DEFAULT_TIMEOUT_MS,
  AUTOPILOT_CLI_WAIT_BUDGET_MS,
  AUTOPILOT_REPORT_SUMMARY_MAX_CHARS,
  AUTOPILOT_RUN_SUMMARY_MAX_CHARS,
  AUTOPILOT_TASK_SPEC_MAX_BYTES,
  AUTOPILOT_TASK_SPEC_REFUSED_KEYS,
  AUTOPILOT_WAIT_SLICE_MAX_MS,
  AutopilotTaskSpecSchema,
  RunCompleteParams,
  TaskProposeParams,
  TaskReportParams,
  TaskShowParams,
  TaskStartParams,
  findRefusedTaskSpecKeys,
  taskSpecSerializedBytes
} from './orchestration-autopilot-params'

const SPEC = {
  objective: 'Summarize the layout of the `src` folder.',
  acceptanceCriteria: ['The report names every top-level folder.']
}

type ParamsSchema = { safeParse(value: unknown): { success: boolean } }

const METHOD_PARAMS: readonly [string, ParamsSchema, Record<string, unknown>][] = [
  ['task-propose', TaskProposeParams, { spec: SPEC }],
  ['task-start', TaskStartParams, { taskId: 'task_1' }],
  ['task-show', TaskShowParams, { taskId: 'task_1' }],
  [
    'task-report',
    TaskReportParams,
    { taskId: 'task_1', attemptId: 'ctx_1', outcome: 'succeeded', summary: 'Done.' }
  ],
  ['run-complete', RunCompleteParams, { summary: 'The run is done.' }]
]

const ROUTING_KEYS = [
  'target',
  'executionTarget',
  'model',
  'effort',
  'reasoningLevel',
  'dataClass'
]

describe('orchestration autopilot params', () => {
  it.each(METHOD_PARAMS)('%s accepts its minimal params', (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true)
  })

  it.each(METHOD_PARAMS)(
    '%s refuses a target, model, effort or data class at the top level',
    (_name, schema, valid) => {
      for (const key of ROUTING_KEYS) {
        expect(schema.safeParse({ ...valid, [key]: 'x' }).success).toBe(false)
      }
    }
  )

  it.each(METHOD_PARAMS)(
    '%s refuses any param that names a caller or a run',
    (_name, schema, valid) => {
      for (const key of ['run', 'runId', 'from', 'callerTerminalHandle', 'terminal', 'paneKey']) {
        expect(schema.safeParse({ ...valid, [key]: 'x' }).success).toBe(false)
      }
    }
  )

  it('refuses every routing key inside the TaskSpec', () => {
    for (const key of ROUTING_KEYS) {
      expect(AutopilotTaskSpecSchema.safeParse({ ...SPEC, [key]: 'x' }).success).toBe(false)
      expect(TaskProposeParams.safeParse({ spec: { ...SPEC, [key]: 'x' } }).success).toBe(false)
    }
  })

  it('needs only an objective: acceptance criteria are optional (D-027)', () => {
    expect(AutopilotTaskSpecSchema.safeParse({ objective: SPEC.objective }).success).toBe(true)
    expect(AutopilotTaskSpecSchema.safeParse({ ...SPEC, acceptanceCriteria: [] }).success).toBe(
      true
    )
    expect(AutopilotTaskSpecSchema.safeParse({ ...SPEC, objective: '' }).success).toBe(false)
    expect(AutopilotTaskSpecSchema.safeParse({ acceptanceCriteria: ['x'] }).success).toBe(false)
  })

  it('has no product size limits on text, lists, checks or dependencies (D-027)', () => {
    const large = {
      objective: 'o'.repeat(50_000),
      title: 't'.repeat(1_000),
      expectedOutputs: Array.from({ length: 100 }, () => 'e'.repeat(5_000)),
      acceptanceCriteria: Array.from({ length: 100 }, () => 'a'.repeat(5_000)),
      constraints: Array.from({ length: 100 }, () => 'c'.repeat(5_000)),
      machineChecks: Array.from({ length: 40 }, () => ({ kind: 'executor_completed' })),
      deps: Array.from({ length: 100 }, (_, index) => `task_${index}`)
    }
    expect(AutopilotTaskSpecSchema.safeParse(large).success).toBe(true)
  })

  it('turns CRLF and a lone CR into LF in every text field and check parameter (M6)', () => {
    const parsed = AutopilotTaskSpecSchema.parse({
      objective: 'One.\r\nTwo.\rThree.',
      expectedOutputs: ['A\r\nB'],
      acceptanceCriteria: ['C\rD'],
      constraints: ['E\r\n'],
      machineChecks: [{ kind: 'artifact_exists', path: 'a\r\nb' }]
    })
    expect(parsed).toMatchObject({
      objective: 'One.\nTwo.\nThree.',
      expectedOutputs: ['A\nB'],
      acceptanceCriteria: ['C\nD'],
      constraints: ['E\n'],
      machineChecks: [{ kind: 'artifact_exists', path: 'a\nb' }]
    })
  })

  it('refuses a two-line title and an over-wide check, as the store does, and keeps other controls (M6, D-027)', () => {
    for (const spec of [
      { objective: 'One.', title: 'One\nTwo' },
      {
        objective: 'One.',
        machineChecks: [{ kind: 'k', a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }]
      },
      { objective: 'One.', machineChecks: [{ kind: 'k', Path: 'a' }] }
    ]) {
      expect(AutopilotTaskSpecSchema.safeParse(spec).success, JSON.stringify(spec)).toBe(false)
    }
    expect(AutopilotTaskSpecSchema.safeParse({ objective: 'One.\n\tTwo.' }).success).toBe(true)
    // D-027 restriction 6: other control characters are kept.
    for (const spec of [
      { objective: 'One.\u001b[2J' },
      { objective: 'One.', constraints: ['a\u0000b'] },
      { objective: 'One.', title: 'Bell\u0007' },
      { objective: 'One.', machineChecks: [{ kind: 'artifact_exists', path: 'a\u0007b' }] }
    ]) {
      expect(AutopilotTaskSpecSchema.safeParse(spec).success, JSON.stringify(spec)).toBe(true)
    }
  })

  it('takes an optional review request, and "model" is the only kind', () => {
    expect(AutopilotTaskSpecSchema.parse({ ...SPEC, review: 'model' })).toMatchObject({
      review: 'model'
    })
    expect(AutopilotTaskSpecSchema.safeParse({ ...SPEC, review: 'machine' }).success).toBe(false)
    expect(AutopilotTaskSpecSchema.safeParse({ ...SPEC, review: true }).success).toBe(false)
  })

  it('measures the serialized TaskSpec against one 256 KiB technical ceiling', () => {
    expect(AUTOPILOT_TASK_SPEC_MAX_BYTES).toBe(256 * 1024)
    expect(taskSpecSerializedBytes(SPEC)).toBe(Buffer.byteLength(JSON.stringify(SPEC), 'utf8'))
    expect(taskSpecSerializedBytes({ objective: '設計' })).toBe(
      Buffer.byteLength('{"objective":"設計"}', 'utf8')
    )
  })

  it('accepts the optional TaskSpec fields the app stores', () => {
    const full = {
      ...SPEC,
      title: 'Layout report',
      expectedOutputs: ['A report named `report.md`.'],
      machineChecks: [{ kind: 'artifact_exists', path: 'report.md' }],
      constraints: ['Do not modify any source file.'],
      accessNeed: 'read_only',
      isolationNeed: 'none',
      workflowName: 'docs-review',
      deps: ['task_0'],
      parentId: 'task_parent'
    }
    expect(AutopilotTaskSpecSchema.parse(full)).toEqual(full)
  })

  it('caps a server wait at 20 seconds', () => {
    expect(AUTOPILOT_WAIT_SLICE_MAX_MS).toBe(20_000)
    expect(TaskShowParams.safeParse({ taskId: 't', waitMs: 20_000 }).success).toBe(true)
    expect(TaskShowParams.safeParse({ taskId: 't', waitMs: 20_001 }).success).toBe(false)
    expect(TaskShowParams.safeParse({ taskId: 't', waitMs: -1 }).success).toBe(false)
  })

  it('keeps the CLI wait budget well below the Bash tool default timeout', () => {
    expect(AUTOPILOT_BASH_DEFAULT_TIMEOUT_MS).toBe(120_000)
    expect(AUTOPILOT_CLI_WAIT_BUDGET_MS + AUTOPILOT_WAIT_SLICE_MAX_MS).toBeLessThan(
      AUTOPILOT_BASH_DEFAULT_TIMEOUT_MS
    )
  })

  it('bounds the report and run summaries and the report outcome', () => {
    const report = { taskId: 't', attemptId: 'a', outcome: 'failed', summary: 'x' }
    expect(TaskReportParams.safeParse(report).success).toBe(true)
    expect(TaskReportParams.safeParse({ ...report, outcome: 'done' }).success).toBe(false)
    expect(
      TaskReportParams.safeParse({
        ...report,
        summary: 'x'.repeat(AUTOPILOT_REPORT_SUMMARY_MAX_CHARS + 1)
      }).success
    ).toBe(false)
    expect(
      RunCompleteParams.safeParse({ summary: 'x'.repeat(AUTOPILOT_RUN_SUMMARY_MAX_CHARS + 1) })
        .success
    ).toBe(false)
  })

  it('refuses ids that carry spaces or path characters', () => {
    expect(TaskStartParams.safeParse({ taskId: 'task 1' }).success).toBe(false)
    expect(TaskStartParams.safeParse({ taskId: '../task' }).success).toBe(false)
  })
})

describe('findRefusedTaskSpecKeys', () => {
  it('names each routing key, also inside machine checks', () => {
    const found = findRefusedTaskSpecKeys({
      ...SPEC,
      model: 'claude-opus-5-5',
      machineChecks: [{ kind: 'artifact_exists', path: 'a', effort: 'max' }]
    })
    expect(found).toEqual(['effort', 'model'])
  })

  it('finds nothing in a clean TaskSpec and ignores non-objects', () => {
    expect(findRefusedTaskSpecKeys(SPEC)).toEqual([])
    expect(findRefusedTaskSpecKeys('text')).toEqual([])
    expect(findRefusedTaskSpecKeys(null)).toEqual([])
  })

  it('lists every key the refusal names', () => {
    expect(AUTOPILOT_TASK_SPEC_REFUSED_KEYS).toEqual(
      expect.arrayContaining(ROUTING_KEYS)
    )
  })
})

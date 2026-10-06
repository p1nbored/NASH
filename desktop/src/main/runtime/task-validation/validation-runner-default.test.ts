import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRunnerWorld, type RunnerWorld } from './validation-runner.test-fixture'

// FIXTURE_ONLY: synthetic routes, reports and review replies; no reviewer or executor runs.
const REPORT = 'I wrote report.md and listed every top-level folder.'
const WORKFLOW_ROUTE = {
  target: 'claude_workflow',
  model: null,
  policyLevel: 'inherit',
  cliSetting: null
} as const
const KEPT_BY_PRIMARY = {
  status: 'not_delegated',
  target: null,
  model: null,
  policyLevel: null,
  cliSetting: null,
  availability: null
} as const
const PRIMARY_ROUTE = {
  target: 'claude_primary',
  model: null,
  policyLevel: 'inherit',
  cliSetting: null
} as const

// D-027: without machine checks and without a review request, no second model is asked by default.
describe('validation runner: the default check (D-027)', () => {
  let world: RunnerWorld
  beforeEach(() => {
    world = createRunnerWorld()
  })
  afterEach(() => world.cleanup())

  const validationOf = (report: Awaited<ReturnType<typeof world.runner.validatePending>>[0]) =>
    report?.outcome === 'settled' ? world.port.getValidation(report.validationId) : null

  it('passes a Codex attempt whose process finished with a result, with no review', async () => {
    const task = world.claimedTask({ spec: { machineChecks: [] } })
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'pass' })
    expect(world.taskStatus(task.taskId)).toBe('completed')
    expect(world.state.reviewRequests).toEqual([])
    expect(world.state.resolverCalls).toBe(0)
    expect(validationOf(report)).toMatchObject({
      policy: 'machine_checks',
      validatorId: 'process_check',
      checks: [
        expect.objectContaining({ kind: 'executor_completed', status: 'pass' }),
        expect.objectContaining({ kind: 'secret_scan_clean', status: 'pass' })
      ]
    })
  })

  it.each([
    ['subagent', undefined],
    ['workflow', WORKFLOW_ROUTE]
  ])(
    'passes a %s attempt on the primary session report, recorded as a claim',
    async (_name, route) => {
      const task = world.inSessionClaim({ spec: { machineChecks: [] }, report: REPORT, route })
      const [report] = await world.runner.validatePending()
      expect(report).toMatchObject({ outcome: 'settled', verdict: 'pass' })
      expect(world.taskStatus(task.taskId)).toBe('completed')
      expect(world.state.reviewRequests).toEqual([])
      const validation = validationOf(report)
      expect(validation).toMatchObject({ policy: 'machine_checks', validatorId: 'session_report' })
      expect(validation?.checks).toEqual([
        expect.objectContaining({ kind: 'session_report', status: 'pass' })
      ])
      expect(validation?.checks[0]?.note).toMatch(/claim/)
      expect(validation?.evidenceRefs).toContainEqual(
        expect.objectContaining({ kind: 'session_report_claim' })
      )
    }
  )

  it.each([
    ['a task the primary keeps', KEPT_BY_PRIMARY],
    ['a claude_primary route', PRIMARY_ROUTE]
  ])(
    'leaves %s inconclusive: its own report is not enough, and no review is billed',
    async (_name, route) => {
      const task = world.inSessionClaim({ spec: { machineChecks: [] }, report: REPORT, route })
      const [report] = await world.runner.validatePending()
      expect(report).toMatchObject({ outcome: 'settled', verdict: 'inconclusive' })
      expect(world.taskStatus(task.taskId)).toBe('blocked')
      expect(world.state.reviewRequests).toEqual([])
      expect(validationOf(report)?.checks).toEqual([
        expect.objectContaining({ kind: 'session_report', status: 'inconclusive' })
      ])
    }
  )

  it('runs the machine checks before a requested review, and bills none when one fails', async () => {
    const task = world.claimedTask({
      spec: { machineChecks: [{ kind: 'artifact_exists', path: 'missing.md' }], review: 'model' }
    })
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'fail' })
    expect(world.state.reviewRequests).toEqual([])
    expect(validationOf(report)?.policy).toBe('model_review')
    expect(world.taskStatus(task.taskId)).toBe('failed')
  })

  it('reviews after passing machine checks when the TaskSpec asks for a review', async () => {
    world.state.reviewOutcome = {
      status: 'completed',
      text: JSON.stringify({
        verdict: 'pass',
        criteria: [{ index: 1, met: true, reason: 'The report names every top-level folder.' }],
        summary: 'The work meets its criterion.'
      }),
      outputSha256: 'd'.repeat(64),
      reportedModels: ['claude-opus-5-5']
    }
    const task = world.claimedTask({
      spec: { machineChecks: [{ kind: 'executor_completed' }], review: 'model' }
    })
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'pass' })
    expect(world.state.reviewRequests).toHaveLength(1)
    expect(validationOf(report)?.checks.map((check) => check.kind)).toEqual([
      'executor_completed',
      'model_review',
      'review_criterion'
    ])
    expect(world.taskStatus(task.taskId)).toBe('completed')
  })
})

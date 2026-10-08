import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRunnerWorld, type RunnerWorld } from './validation-runner.test-fixture'

const PASS = JSON.stringify({
  verdict: 'pass',
  criteria: [{ index: 1, met: true, reason: 'The report names every top-level folder.' }],
  summary: 'The work meets its criterion.'
})
const REPORT = 'I wrote report.md and listed every top-level folder.'

describe('validation runner: in-session attempts', () => {
  let world: RunnerWorld
  beforeEach(() => {
    world = createRunnerWorld()
    world.state.reviewOutcome = {
      status: 'completed',
      text: PASS,
      outputSha256: 'd'.repeat(64),
      reportedModels: ['claude-opus-5-5']
    }
  })
  afterEach(() => world.cleanup())

  const settledValidation = (
    report: Awaited<ReturnType<typeof world.runner.validatePending>>[0]
  ) => (report?.outcome === 'settled' ? world.port.getValidation(report.validationId) : null)

  it("reviews the primary's report when the TaskSpec asks for a model review, fenced as untrusted data", async () => {
    const task = world.inSessionClaim({
      spec: { machineChecks: [], review: 'model' },
      report: REPORT
    })
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'pass' })
    expect(world.taskStatus(task.taskId)).toBe('completed')
    const [request] = world.state.reviewRequests
    expect(request?.prompt).toContain('a claim, not proof')
    expect(request?.prompt).toMatch(
      new RegExp(
        `<<<UNTRUSTED_RESULT_BEGIN ([0-9a-f]{16})>>>\\n${REPORT}\\n<<<UNTRUSTED_RESULT_END \\1>>>`
      )
    )
    expect(settledValidation(report)?.evidenceRefs).toContainEqual(
      expect.objectContaining({ kind: 'session_report' })
    )
  })

  it('stays inconclusive, and bills no review, when the report is missing', async () => {
    world.inSessionClaim({ spec: { machineChecks: [] } })
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'inconclusive' })
    expect(world.state.reviewRequests).toEqual([])
    expect(settledValidation(report)?.checks).toEqual([
      expect.objectContaining({ kind: 'session_report', status: 'inconclusive' })
    ])
  })

  it('stays inconclusive, and bills no review, when a requested review has no report', async () => {
    world.inSessionClaim({ spec: { machineChecks: [], review: 'model' } })
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'inconclusive' })
    expect(world.state.reviewRequests).toEqual([])
    expect(settledValidation(report)?.checks).toEqual([
      expect.objectContaining({ kind: 'model_review', status: 'inconclusive' })
    ])
  })

  it('stays inconclusive when the mailbox report does not match the current attempt', async () => {
    const task = world.inSessionClaim({ spec: { machineChecks: [] } })
    world.harness.owner.insertMessage({
      runId: world.harness.runId,
      from: `dispatch:${task.dispatchId}`,
      to: `run:${world.harness.runId}`,
      subject: 'Task claimed',
      body: REPORT,
      type: 'status',
      priority: 'normal',
      payload: JSON.stringify({
        taskId: 'task_other',
        dispatchId: task.dispatchId,
        outcome: 'claimed'
      })
    })
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ verdict: 'inconclusive' })
    expect(world.state.reviewRequests).toEqual([])
  })

  it('keeps an unknown machine check inconclusive instead of treating the claim as proof', async () => {
    world.inSessionClaim({
      spec: { machineChecks: [{ kind: 'unknown_check' }] },
      report: REPORT
    })
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ verdict: 'inconclusive' })
    expect(settledValidation(report)?.checks).toContainEqual(
      expect.objectContaining({
        kind: 'unknown_check',
        status: 'inconclusive',
        note: 'The check kind `unknown_check` is not one the validators know.'
      })
    )
  })
})

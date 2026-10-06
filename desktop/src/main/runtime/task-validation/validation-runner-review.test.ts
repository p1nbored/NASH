import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import {
  createRunnerWorld,
  reviewerResolution,
  type RunnerWorld
} from './validation-runner.test-fixture'

// FIXTURE_ONLY: the token below is synthetic and obviously fake.
const FAKE_TOKEN = 'sk-0123456789abcdef0123456789abcdef'

const reply = (verdict: 'pass' | 'fail', reason = 'The report names every top-level folder.') =>
  JSON.stringify({
    verdict,
    criteria: [{ index: 1, met: verdict === 'pass', reason }],
    summary: verdict === 'pass' ? 'The work meets its criterion.' : 'The work misses its criterion.'
  })

describe('validation runner: review by a different model', () => {
  let world: RunnerWorld
  beforeEach(() => {
    world = createRunnerWorld()
  })
  afterEach(() => world.cleanup())

  function reviewedTask() {
    // D-027: a model review runs only when the TaskSpec asks for one.
    return world.claimedTask({ spec: { machineChecks: [], review: 'model' } })
  }

  it('completes the task on a passing review by the first reviewer of another model', async () => {
    world.state.reviewOutcome = {
      status: 'completed',
      text: reply('pass'),
      outputSha256: 'd'.repeat(64),
      reportedModels: ['claude-opus-5-5']
    }
    const task = reviewedTask()
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'pass' })
    expect(world.taskStatus(task.taskId)).toBe('completed')
    const validation =
      report?.outcome === 'settled' ? world.port.getValidation(report.validationId) : null
    expect(validation).toMatchObject({
      policy: 'model_review',
      workerModel: 'gpt-6.1-sol',
      reviewerModel: 'claude-opus-5-5'
    })
    const [request] = world.state.reviewRequests
    expect(request).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'high',
      workspacePath: world.workspace,
      workspaceKind: 'git'
    })
    expect(request?.prompt).toContain('Summarize the repository layout in a short report.')
    expect(request?.prompt).toMatch(
      /<<<UNTRUSTED_RESULT_BEGIN ([0-9a-f]{16})>>>\nDone.\n<<<UNTRUSTED_RESULT_END \1>>>/
    )
  })

  it('fails the task on a failing review', async () => {
    world.state.reviewOutcome = {
      status: 'completed',
      text: reply('fail', 'A folder is missing.'),
      outputSha256: 'd'.repeat(64),
      reportedModels: ['claude-opus-5-5']
    }
    const task = reviewedTask()
    await world.runner.validatePending()
    expect(world.taskStatus(task.taskId)).toBe('failed')
  })

  it('leaves the task to the user or dot when the reviewer is unverified, and tries no other reviewer', async () => {
    world.state.resolution = reviewerResolution('unverified')
    const task = reviewedTask()
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ verdict: 'inconclusive' })
    expect(world.state.reviewRequests).toEqual([])
    expect(world.taskStatus(task.taskId)).toBe('blocked')
    const validation =
      report?.outcome === 'settled' ? world.port.getValidation(report.validationId) : null
    expect(validation?.reviewerModel).toBe('claude-opus-5-5')
    expect(world.decisions.listPendingDecisions(10)).toHaveLength(1)
  })

  it('records an inconclusive review when no independent reviewer exists', async () => {
    world.state.resolution = { ok: false, reason: 'no_independent_reviewer' }
    reviewedTask()
    const [report] = await world.runner.validatePending()
    const validation =
      report?.outcome === 'settled' ? world.port.getValidation(report.validationId) : null
    expect(validation).toMatchObject({ verdict: 'inconclusive', reviewerModel: 'unassigned' })
    expect(validation?.checks[0]?.note).toBe(
      'No independent reviewer is available (no_independent_reviewer).'
    )
  })

  it('treats a review left pending by an earlier run as interrupted, and does not bill it again', async () => {
    const task = reviewedTask()
    world.port.open({
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      policy: 'model_review',
      validatorId: 'model_review',
      workerModel: 'gpt-6.1-sol',
      reviewerModel: 'claude-opus-5-5',
      timestamp: fixtureTime(8)
    })
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ verdict: 'inconclusive' })
    expect(world.state.reviewRequests).toEqual([])
    // Why: a resumed review is settled before any reviewer is selected or probed.
    expect(world.state.resolverCalls).toBe(0)
  })

  it('masks a secret the reviewer echoed before it reaches the record', async () => {
    world.state.reviewOutcome = {
      status: 'completed',
      text: reply('pass', `The report quotes the key ${FAKE_TOKEN}.`),
      outputSha256: 'd'.repeat(64),
      reportedModels: ['claude-opus-5-5']
    }
    reviewedTask()
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ verdict: 'pass' })
    const validation =
      report?.outcome === 'settled' ? world.port.getValidation(report.validationId) : null
    expect(JSON.stringify(validation)).not.toContain(FAKE_TOKEN)
  })

  it('does not run a reviewer without tools when there is no worker result to judge', async () => {
    const task = reviewedTask()
    rmSync(world.resultPath(task.dispatchId))
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'inconclusive' })
    expect(world.state.reviewRequests).toEqual([])
    expect(world.taskStatus(task.taskId)).toBe('blocked')
  })

  it('records a reviewer that crashed as inconclusive instead of leaving the review pending', async () => {
    world.state.reviewThrows = true
    const task = reviewedTask()
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'inconclusive' })
    expect(world.decisions.listPendingDecisions(10)).toEqual([
      expect.objectContaining({ dispatchId: task.dispatchId, verdict: 'inconclusive' })
    ])
  })
})

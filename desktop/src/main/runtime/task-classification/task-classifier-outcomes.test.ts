import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import type { SyntheticClefBody } from '../../clef/fixtures/synthetic-clef-responses.test-fixture'
import { getTaskRouteStore } from '../orchestration/db/task-route-store'
import { transportResponding } from '../workbench-routing/clef-scripted-transport.test-fixture'
import type { FixtureClefAnswer } from '../workbench-routing/workbench-routing.test-fixture'
import { proposeFixtureTask, FIXTURE_RUN_TABLE } from './classification-db.test-fixture'
import { createClassifierHarness, type ClassifierHarness } from './classification-deps.test-fixture'
import { loadClassificationSubject } from './classification-subject'
import { createTaskClassifier } from './task-classifier'

// FIXTURE_ONLY: scripted Clef answers; the routing table is the bundled default in a memory store.
const NEVER_ABORTED = new AbortController().signal

/** Task-type probabilities with the chosen option leading the next one by `margin`. */
function taskTypeWithMargin(choice: string, runnerUp: string, margin: number) {
  return (body: SyntheticClefBody): unknown => {
    const answer = body.answers.task_type
    const sent = answer.probabilities
    const ids = typeof sent === 'object' && sent !== null ? Object.keys(sent) : []
    const top = 0.45
    const rest = (1 - top - (top - margin)) / (ids.length - 2)
    const probabilities = Object.fromEntries(
      ids.map((id) => [id, id === choice ? top : id === runnerUp ? top - margin : rest])
    )
    return {
      ...body,
      answers: { ...body.answers, task_type: { ...answer, choice, probabilities } }
    }
  }
}

describe('TaskSpec classification outcome rules (design 1.3, in order)', () => {
  let harness: ClassifierHarness | null = null

  beforeEach(() => setClefCallCircuit(null))
  afterEach(() => {
    harness?.db.owner.close()
    harness = null
    setClefCallCircuit(null)
  })

  async function classifyWith(answer: FixtureClefAnswer) {
    harness = createClassifierHarness({ transport: transportResponding(answer) })
    const task = proposeFixtureTask(harness.db)
    const subject = loadClassificationSubject(harness.db.owner, task.taskId)
    const result = await createTaskClassifier(harness.deps).classify(subject, NEVER_ABORTED)
    return { result, task, harness }
  }

  it('1. records a response that fails validation as invalid_output with its detail', async () => {
    const { result } = await classifyWith({ edit: () => ({ unexpected: true }) })
    expect(result.classification).toMatchObject({
      outcome: 'invalid_output',
      detail: 'response_schema_violation',
      needsDelegation: null,
      taskType: null
    })
    expect(result.classification.rawResponseId).not.toBeNull()
    expect(result.route).toEqual({ kind: 'not_requested' })
  })

  it('2. turns needs_clarification into missing_inputs before any band check', async () => {
    const { result } = await classifyWith({
      choices: { task_type: 'needs_clarification', needs_delegation: 0.5 }
    })
    expect(result.classification).toMatchObject({
      outcome: 'blocked',
      detail: 'needs_clarification'
    })
    expect(result.classification.answers).toMatchObject({
      answers: { taskType: 'needs_clarification' },
      blocker: { reason: 'missing_inputs', detail: 'needs_clarification' }
    })
  })

  it('3. blocks a task-type margin under 0.10 as ambiguous before the delegation rule', async () => {
    const { result } = await classifyWith({
      choices: { task_type: 'coordinator_reasoning', needs_delegation: 0.9 },
      edit: taskTypeWithMargin('coordinator_reasoning', 'software_engineering', 0.05)
    })
    expect(result.classification).toMatchObject({ outcome: 'blocked', detail: 'low_margin' })
  })

  it('4. blocks a delegation probability inside the 0.4-0.6 band as ambiguous', async () => {
    const { result } = await classifyWith({
      choices: { task_type: 'software_engineering', needs_delegation: 0.5 }
    })
    expect(result.classification).toMatchObject({ outcome: 'blocked', detail: 'low_margin' })
  })

  it('5. blocks delegation of coordinator reasoning as inconsistent', async () => {
    const { result } = await classifyWith({
      choices: { task_type: 'coordinator_reasoning', needs_delegation: 0.9 }
    })
    expect(result.classification).toMatchObject({
      outcome: 'blocked',
      detail: 'inconsistent_delegation'
    })
    expect(result.route).toEqual({ kind: 'not_requested' })
  })

  it('6a. classifies a delegated TaskSpec and records the active table route as resolved', async () => {
    const {
      result,
      task,
      harness: h
    } = await classifyWith({
      choices: { task_type: 'software_engineering', needs_delegation: 0.82 }
    })
    expect(result.classification).toMatchObject({
      taskId: task.taskId,
      attempt: 1,
      outcome: 'classified',
      detail: null,
      needsDelegation: true,
      taskType: 'software_engineering',
      classifierModel: '@cf/cloudflare/clef',
      taxonomyVersion: 2
    })
    expect(result.route.kind).toBe('recorded')
    const route = getTaskRouteStore(h.db.owner).latestForTask(task.taskId)
    expect(route).toMatchObject({
      classificationId: result.classification.classificationId,
      target: 'claude_subagent',
      model: 'claude-sonnet-5-5',
      policyLevel: 'max',
      status: 'available',
      reasons: []
    })
    expect(route?.routingTableSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(route?.availability).toMatchObject({
      status: 'available',
      subject: { target: 'claude_subagent', model: 'claude-sonnet-5-5', reasoningLevel: 'max' }
    })
    expect(h.routing.lookups()).toBe(1)
  })

  it('6b. classifies a TaskSpec the primary keeps, with no table lookup and its run table named', async () => {
    const {
      result,
      task,
      harness: h
    } = await classifyWith({
      choices: { task_type: 'high_quality_writing', needs_delegation: 0.2 }
    })
    expect(result.classification).toMatchObject({
      outcome: 'classified',
      needsDelegation: false,
      taskType: 'high_quality_writing'
    })
    expect(getTaskRouteStore(h.db.owner).latestForTask(task.taskId)).toMatchObject({
      status: 'not_delegated',
      target: null,
      model: null,
      routingTableVersion: FIXTURE_RUN_TABLE.version,
      routingTableSha256: FIXTURE_RUN_TABLE.sha256
    })
    expect(h.routing.lookups()).toBe(0)
  })

  it('keeps every answer and its evidence in English codes and hashes', async () => {
    const { result } = await classifyWith({})
    const answers = result.classification.answers
    expect(answers).toMatchObject({
      answers: { taskType: 'software_engineering', needsDelegation: 0.82 },
      blocker: null,
      evidence: { attempts: 1, cacheSource: null, transportErrorClass: null }
    })
    expect(JSON.stringify(answers)).not.toMatch(/retry button/)
  })
})

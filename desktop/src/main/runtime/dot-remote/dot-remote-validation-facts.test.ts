import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DotValidationViewSchema } from '../../../shared/dot-ingress/dot-ingress-validation'
import {
  createDotHarness,
  fixtureUuid,
  type DotHarness
} from '../dot-ingress/dot-ingress-service.test-fixture'
import { dotStartedRun } from '../dot-ingress/dot-ingress-validation.test-fixture'
import { decideDotValidation } from '../dot-ingress/dot-ingress-validations-service'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { createTaskValidationPort } from '../task-validation/task-validation-port'
import { inconclusiveAttempt } from '../task-validation/validation-decision.test-fixture'
import { createDotRemoteLocalReaders } from './dot-remote-local-readers'
import { createDotRemoteValidationFacts } from './dot-remote-validation-facts'

// FIXTURE_ONLY: the validation decisions the event sync reads, from the real stores through G6's
// decision service and the dot exposure, never the desktop view.

describe('validation decision facts', () => {
  let dot: DotHarness
  beforeEach(() => {
    dot = createDotHarness()
  })
  afterEach(() => dot.close())

  const readers = () => createDotRemoteLocalReaders({ db: () => dot.owner, listForDot: () => [] })
  const known = (validationIds: string[] = []) => ({ messageIds: [], validationIds })

  it('reports a waiting decision of a followed request with exactly the dot view', async () => {
    const run = await dotStartedRun(dot)
    const task = inconclusiveAttempt(run.harness)
    const source = readers()
    source.beginSync?.([run.dotRequestId])
    const snapshot = source.snapshot(run.dotRequestId, known())
    expect(snapshot?.awaitsValidationDecision).toBe(true)
    expect(snapshot?.validationDecisions).toHaveLength(1)
    const [fact] = snapshot?.validationDecisions ?? []
    expect(fact?.kind).toBe('pending')
    const view = fact?.kind === 'pending' ? fact.view : null
    expect(DotValidationViewSchema.parse(view)).toMatchObject({
      validationId: task.validationId,
      dotRequestId: run.dotRequestId
    })
    expect(Object.keys(view ?? {}).sort()).toEqual(
      [
        'createdAt',
        'dotRequestId',
        'reason',
        'summary',
        'summaryWithheld',
        'title',
        'validationId'
      ].sort()
    )
  })

  it('reports nothing waiting for a request the sync does not follow', async () => {
    const run = await dotStartedRun(dot)
    inconclusiveAttempt(run.harness)
    const source = readers()
    source.beginSync?.([])
    const snapshot = source.snapshot(run.dotRequestId, known())
    expect(snapshot?.validationDecisions).toEqual([])
    expect(snapshot?.awaitsValidationDecision).toBe(true)
  })

  it('reports how a reported decision ended once it no longer waits', async () => {
    const run = await dotStartedRun(dot)
    const task = inconclusiveAttempt(run.harness)
    await decideDotValidation(dot.deps, {
      decisionId: fixtureUuid(100),
      validationId: task.validationId,
      decision: 'waive'
    })
    const source = readers()
    source.beginSync?.([run.dotRequestId])
    const snapshot = source.snapshot(run.dotRequestId, known([task.validationId]))
    expect(snapshot?.awaitsValidationDecision).toBe(false)
    expect(snapshot?.validationDecisions).toEqual([
      {
        kind: 'settled',
        settled: {
          validationId: task.validationId,
          outcome: 'waived',
          decidedAt: dot.deps.now().toISOString()
        }
      }
    ])
  })

  it('reports a decision a validator settled since as closed, and nothing for one still waiting', async () => {
    const run = await dotStartedRun(dot)
    const closed = inconclusiveAttempt(run.harness)
    const waiting = inconclusiveAttempt(run.harness)
    createTaskValidationPort(dot.owner).recordVerdict({
      validationId: closed.validationId,
      verdict: 'fail',
      checks: [{ kind: 'artifact_exists', status: 'fail', note: 'Missing.' }],
      evidenceRefs: [],
      timestamp: fixtureTime(20)
    })
    const facts = createDotRemoteValidationFacts({ openMax: 0 })
    facts.begin([run.dotRequestId])
    expect(
      facts.factsOf(dot.owner, run.dotRequestId, [closed.validationId, waiting.validationId])
    ).toEqual([
      {
        kind: 'settled',
        settled: { validationId: closed.validationId, outcome: 'closed', decidedAt: null }
      }
    ])
  })

  it('reports at most the open cap across followed requests, the oldest first', async () => {
    const first = await dotStartedRun(dot, 1)
    const second = await dotStartedRun(dot, 2)
    const older = inconclusiveAttempt(first.harness)
    const newer = inconclusiveAttempt(second.harness)
    const facts = createDotRemoteValidationFacts({ openMax: 1 })
    const pendingIds = () =>
      [first.dotRequestId, second.dotRequestId].flatMap((id) =>
        facts
          .factsOf(dot.owner, id, [])
          .flatMap((fact) => (fact.kind === 'pending' ? [fact.view.validationId] : []))
      )
    facts.begin([first.dotRequestId, second.dotRequestId])
    expect(pendingIds()).toEqual([older.validationId])
    await decideDotValidation(dot.deps, {
      decisionId: fixtureUuid(100),
      validationId: older.validationId,
      decision: 'reject'
    })
    facts.begin([first.dotRequestId, second.dotRequestId])
    expect(pendingIds()).toEqual([newer.validationId])
  })
})

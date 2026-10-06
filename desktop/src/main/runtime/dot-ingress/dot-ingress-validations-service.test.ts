import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DotValidationViewSchema } from '../../../shared/dot-ingress/dot-ingress-validation'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getTaskValidationStore } from '../orchestration/db/task-validation-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { createTaskValidationPort } from '../task-validation/task-validation-port'
import { createValidationDecisionService } from '../task-validation/validation-decision-service'
import {
  FIXTURE_REASON,
  inconclusiveAttempt
} from '../task-validation/validation-decision.test-fixture'
import { createDotHarness, fixtureUuid, type DotHarness } from './dot-ingress-service.test-fixture'
import { dotStartedRun, seedWorkflowRun } from './dot-ingress-validation.test-fixture'
import { decideDotValidation, listDotValidations } from './dot-ingress-validations-service'

async function codeOfAsync(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : `unexpected: ${String(error)}`
  }
}

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : `unexpected: ${String(error)}`
  }
}

describe('dot validation decisions service', () => {
  let dot: DotHarness
  beforeEach(() => {
    dot = createDotHarness()
  })
  afterEach(() => dot.close())

  const status = (taskId: string) => dot.owner.getTask(taskId)?.status
  const decide = (validationId: string, decision: 'waive' | 'reject', key = 100) =>
    decideDotValidation(dot.deps, { decisionId: fixtureUuid(key), validationId, decision })

  describe('list', () => {
    it('lists only the waiting results of runs dot started, oldest first, as narrow views', async () => {
      const first = await dotStartedRun(dot, 1)
      const second = await dotStartedRun(dot, 2)
      const a = inconclusiveAttempt(first.harness)
      const b = inconclusiveAttempt(second.harness)
      const desktop = seedWorkflowRun(dot, 'request_desktop_fixture')
      inconclusiveAttempt(desktop)
      const listed = listDotValidations(dot.deps, { limit: 10 })
      expect(listed.hasMore).toBe(false)
      expect(listed.views.map((view) => [view.validationId, view.dotRequestId])).toEqual([
        [a.validationId, first.dotRequestId],
        [b.validationId, second.dotRequestId]
      ])
      for (const view of listed.views) {
        expect(DotValidationViewSchema.parse(view)).toMatchObject({
          reason: 'checks_inconclusive',
          summary: FIXTURE_REASON,
          summaryWithheld: false
        })
      }
    })

    it('filters by request and pages with hasMore', async () => {
      const first = await dotStartedRun(dot, 1)
      const second = await dotStartedRun(dot, 2)
      inconclusiveAttempt(first.harness)
      inconclusiveAttempt(first.harness)
      const b = inconclusiveAttempt(second.harness)
      expect(
        listDotValidations(dot.deps, { dotRequestId: second.dotRequestId, limit: 10 }).views.map(
          (view) => view.validationId
        )
      ).toEqual([b.validationId])
      const page = listDotValidations(dot.deps, { limit: 2 })
      expect(page.views).toHaveLength(2)
      expect(page.hasMore).toBe(true)
    })

    it('refuses while the dot interface is off', async () => {
      const run = await dotStartedRun(dot)
      inconclusiveAttempt(run.harness)
      getDotIngressSettingsStore(dot.owner).setEnabled({
        enabled: false,
        timestamp: '2026-10-05T00:00:11.000Z'
      })
      expect(codeOf(() => listDotValidations(dot.deps, { limit: 10 }))).toBe('dot_ingress_disabled')
    })
  })

  describe('decide', () => {
    it('waives through the shared decision service as dot and files the notice', async () => {
      const run = await dotStartedRun(dot)
      const task = inconclusiveAttempt(run.harness)
      const result = await decide(task.validationId, 'waive')
      expect(result).toEqual({
        decisionId: fixtureUuid(100),
        validationId: task.validationId,
        dotRequestId: run.dotRequestId,
        outcome: 'decided',
        decidedAt: dot.deps.now().toISOString(),
        duplicate: false
      })
      expect(status(task.taskId)).toBe('completed')
      expect(getTaskValidationStore(dot.owner).get(task.validationId)?.waiver).toBe('dot')
      expect(dot.announced).toHaveLength(1)
      expect(dot.announced[0]?.body).toContain('waived from dot')
      expect(listDotValidations(dot.deps, { limit: 10 }).views).toEqual([])
    })

    it('rejects, which fails the task', async () => {
      const run = await dotStartedRun(dot)
      const task = inconclusiveAttempt(run.harness)
      expect(await decide(task.validationId, 'reject')).toMatchObject({ outcome: 'decided' })
      expect(status(task.taskId)).toBe('failed')
    })

    it('answers a replay with the first outcome and files nothing more', async () => {
      const run = await dotStartedRun(dot)
      const task = inconclusiveAttempt(run.harness)
      const first = await decide(task.validationId, 'waive')
      dot.advanceClock(5_000)
      expect(await decide(task.validationId, 'waive')).toEqual({ ...first, duplicate: true })
      expect(dot.announced).toHaveLength(1)
    })

    it('answers two concurrent calls with one decision id from one decision', async () => {
      const run = await dotStartedRun(dot)
      const task = inconclusiveAttempt(run.harness)
      const [one, two] = await Promise.all([
        decide(task.validationId, 'waive'),
        decide(task.validationId, 'waive')
      ])
      expect([one.duplicate, two.duplicate].sort()).toEqual([false, true])
      expect({ ...one, duplicate: false }).toEqual({ ...two, duplicate: false })
      expect(one.outcome).toBe('decided')
      expect(dot.announced).toHaveLength(1)
    })

    it('refuses the same decision id with another decision or another validation', async () => {
      const run = await dotStartedRun(dot)
      const task = inconclusiveAttempt(run.harness)
      const other = inconclusiveAttempt(run.harness)
      await decide(task.validationId, 'waive')
      expect(await codeOfAsync(() => decide(task.validationId, 'reject'))).toBe(
        'dot_idempotency_conflict'
      )
      expect(await codeOfAsync(() => decide(other.validationId, 'waive'))).toBe(
        'dot_idempotency_conflict'
      )
      expect(status(other.taskId)).toBe('blocked')
    })

    it('tells a second decision id that the first decision already won', async () => {
      const run = await dotStartedRun(dot)
      const task = inconclusiveAttempt(run.harness)
      const first = await decide(task.validationId, 'waive', 100)
      dot.advanceClock(5_000)
      expect(await decide(task.validationId, 'reject', 101)).toEqual({
        ...first,
        decisionId: fixtureUuid(101),
        outcome: 'already_decided'
      })
      expect(status(task.taskId)).toBe('completed')
    })

    it('reports a desktop decision that won first as already decided', async () => {
      const run = await dotStartedRun(dot)
      const task = inconclusiveAttempt(run.harness)
      await createValidationDecisionService({ owner: dot.owner, now: dot.deps.now }).decide({
        validationId: task.validationId,
        decision: 'reject',
        by: 'desktop_user'
      })
      dot.advanceClock(5_000)
      expect(await decide(task.validationId, 'waive')).toMatchObject({
        outcome: 'already_decided',
        decidedAt: '2026-10-05T00:00:10.000Z',
        duplicate: false
      })
    })

    it('closes a decision a validator settled since, with no decision time', async () => {
      const run = await dotStartedRun(dot)
      const task = inconclusiveAttempt(run.harness)
      createTaskValidationPort(dot.owner).recordVerdict({
        validationId: task.validationId,
        verdict: 'fail',
        checks: [{ kind: 'artifact_exists', status: 'fail', note: 'Missing.' }],
        evidenceRefs: [],
        timestamp: fixtureTime(20)
      })
      expect(await decide(task.validationId, 'waive')).toMatchObject({
        outcome: 'closed',
        decidedAt: null
      })
    })

    it('does not reveal a validation of another run, an unknown one or one without a result', async () => {
      const desktop = seedWorkflowRun(dot, 'request_desktop_fixture')
      const foreign = inconclusiveAttempt(desktop)
      const run = await dotStartedRun(dot)
      const pending = inconclusiveAttempt(run.harness, { verdict: 'pending' })
      for (const [key, validationId] of [
        [100, foreign.validationId],
        [101, 'validation_unknown'],
        [102, pending.validationId]
      ] as const) {
        expect(await codeOfAsync(() => decide(validationId, 'waive', key))).toBe(
          'dot_validation_not_found'
        )
      }
      expect(status(foreign.taskId)).toBe('blocked')
      expect(dot.announced).toEqual([])
    })

    it('counts decisions against the user caps, but not a replay', async () => {
      getDotIngressSettingsStore(dot.owner).setRateLimits({
        ratePerMinute: 1,
        ratePerUtcDay: 10_000,
        timestamp: '2026-10-05T00:00:10.000Z'
      })
      const run = await dotStartedRun(dot)
      const task = inconclusiveAttempt(run.harness)
      const other = inconclusiveAttempt(run.harness)
      await decide(task.validationId, 'waive', 100)
      expect((await decide(task.validationId, 'waive', 100)).duplicate).toBe(true)
      expect(await codeOfAsync(() => decide(other.validationId, 'waive', 101))).toBe(
        'dot_rate_limited'
      )
      dot.advanceClock(61_000)
      expect((await decide(other.validationId, 'waive', 101)).outcome).toBe('decided')
    })

    it('refuses while the dot interface is off', async () => {
      const run = await dotStartedRun(dot)
      const task = inconclusiveAttempt(run.harness)
      getDotIngressSettingsStore(dot.owner).setEnabled({
        enabled: false,
        timestamp: '2026-10-05T00:00:11.000Z'
      })
      expect(await codeOfAsync(() => decide(task.validationId, 'waive'))).toBe(
        'dot_ingress_disabled'
      )
      expect(status(task.taskId)).toBe('blocked')
    })
  })
})

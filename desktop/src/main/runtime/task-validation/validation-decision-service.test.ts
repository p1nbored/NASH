import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchValidationListDecisionsResultSchema } from '../../../shared/rpc-contract/workbench-validation-decision-params'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import { getTaskValidationStore } from '../orchestration/db/task-validation-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { MessageRow } from '../orchestration/types'
import type { WorkflowRunOrigin } from '../workflow-run/workflow-run-origin'
import { FIXTURE_REASON, inconclusiveAttempt } from './validation-decision.test-fixture'
import {
  createValidationDecisionService,
  type ValidationDecisionService
} from './validation-decision-service'

const NOW = new Date('2026-10-06T08:00:00.000Z')
async function asyncCodeOf(operation: () => Promise<unknown>): Promise<string | null> {
  try {
    await operation()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : `unexpected: ${String(error)}`
  }
}

describe('validation decision service', () => {
  let harness: AppRunHarness
  let origin: WorkflowRunOrigin
  let announce: ReturnType<typeof vi.fn<(message: MessageRow) => void>>
  let service: ValidationDecisionService

  beforeEach(() => {
    harness = createAppRunHarness()
    origin = 'desktop'
    announce = vi.fn<(message: MessageRow) => void>()
    service = createValidationDecisionService({
      owner: harness.owner,
      now: () => NOW,
      announce,
      readOrigin: () => origin
    })
  })
  afterEach(() => harness.owner.close())

  const status = (taskId: string) => harness.owner.getTask(taskId)?.status
  const validation = (id: string) => getTaskValidationStore(harness.owner).get(id)
  const announced = (): MessageRow => {
    expect(announce).toHaveBeenCalledTimes(1)
    const [message] = announce.mock.calls[0] ?? []
    if (!message) {
      throw new Error('no message announced')
    }
    return message
  }

  describe('listPending', () => {
    it('lists nothing while no validation waits for a decision', () => {
      inconclusiveAttempt(harness, { verdict: 'pending' })
      expect(service.listPending({ limit: 10 })).toEqual({ decisions: [], hasMore: false })
    })

    it('describes each inconclusive in-session result for the desktop', () => {
      const write = inconclusiveAttempt(harness)
      const listed = service.listPending({ limit: 10 })
      expect(WorkbenchValidationListDecisionsResultSchema.safeParse(listed).success).toBe(true)
      expect(listed).toEqual({
        decisions: [
          {
            validationId: write.validationId,
            runId: harness.runId,
            taskId: write.taskId,
            dispatchId: write.dispatchId,
            title: 'Summarize the repository layout in a short report.',
            executorKind: 'claude_primary',
            model: null,
            reason: FIXTURE_REASON,
            inconclusiveAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
          }
        ],
        hasMore: false
      })
    })

    it('shows a title with terminal and bidi controls as plain spaces', () => {
      const attempt = inconclusiveAttempt(harness)
      harness.owner.db
        .prepare('UPDATE tasks SET task_title = ? WHERE id = ?')
        .run('Fix\u202Egnp.exe\u0007probe\u2028now\u2066x', attempt.taskId)
      const [view] = service.listPending({ limit: 10 }).decisions
      expect(view?.title).toBe('Fix gnp.exe probe now x')
    })

    it('bounds the list and says when more are waiting', () => {
      inconclusiveAttempt(harness)
      inconclusiveAttempt(harness)
      inconclusiveAttempt(harness)
      const first = service.listPending({ limit: 2 })
      expect(first.decisions).toHaveLength(2)
      expect(first.hasMore).toBe(true)
      expect(service.listPending({ limit: 3 }).hasMore).toBe(false)
    })

    it('filters by the run origin, so dot can be shown only the runs dot started', () => {
      inconclusiveAttempt(harness)
      expect(service.listPending({ limit: 10, origin: 'dot' }).decisions).toEqual([])
      origin = 'dot'
      expect(service.listPending({ limit: 10, origin: 'dot' }).decisions).toHaveLength(1)
    })
  })

  describe('decide', () => {
    const waive = (validationId: string) =>
      service.decide({ validationId, decision: 'waive', by: 'desktop_user' })

    it('waives an in-session result, completes the task and notifies the primary', async () => {
      const write = inconclusiveAttempt(harness)
      const outcome = await waive(write.validationId)
      expect(outcome).toEqual({
        validationId: write.validationId,
        taskId: write.taskId,
        runId: harness.runId,
        decision: 'waived',
        taskStatus: 'completed',
        noticeFiled: true
      })
      expect(status(write.taskId)).toBe('completed')
      expect(validation(write.validationId)).toMatchObject({
        verdict: 'inconclusive',
        waiver: 'desktop_user',
        waivedAt: NOW.toISOString()
      })
      const message = announced()
      expect(message.to_handle).toBe(`run:${harness.runId}`)
      expect(message.subject).toBe(`Validation waived for task ${write.taskId}`)
      expect(message.body).toBe(
        `The inconclusive validation of task \`${write.taskId}\` was waived by the user, so the task is completed.`
      )
      expect(service.listPending({ limit: 10 }).decisions).toEqual([])
    })

    it('rejects an in-session result, fails the task and notifies the primary', async () => {
      const write = inconclusiveAttempt(harness)
      const outcome = await service.decide({
        validationId: write.validationId,
        decision: 'reject',
        by: 'desktop_user'
      })
      expect(outcome).toMatchObject({ decision: 'rejected', taskStatus: 'failed' })
      expect(status(write.taskId)).toBe('failed')
      expect(validation(write.validationId)?.verdict).toBe('fail')
      expect(announced().body).toContain('was rejected by the user, so the task is failed.')
    })

    it('returns the store conflict for a repeated or late decision and changes nothing', async () => {
      const first = inconclusiveAttempt(harness)
      await waive(first.validationId)
      for (const decision of ['waive', 'reject'] as const) {
        expect(
          await asyncCodeOf(() =>
            service.decide({ validationId: first.validationId, decision, by: 'desktop_user' })
          )
        ).toBe('autopilot_validation_conflict')
      }
      expect(status(first.taskId)).toBe('completed')
      expect(announce).toHaveBeenCalledTimes(1)
    })

    it('refuses a validation that has no result yet, and one that does not exist', async () => {
      const waiting = inconclusiveAttempt(harness, { verdict: 'pending' })
      expect(await asyncCodeOf(() => waive(waiting.validationId))).toBe(
        'autopilot_validation_conflict'
      )
      expect(status(waiting.taskId)).toBe('blocked')
      expect(
        await asyncCodeOf(() =>
          service.decide({
            validationId: 'validation_unknown',
            decision: 'reject',
            by: 'desktop_user'
          })
        )
      ).toBe('autopilot_validation_not_found')
      expect(announce).not.toHaveBeenCalled()
    })

    it('lets dot decide only for a run dot started, and says so in the notice', async () => {
      const attempt = inconclusiveAttempt(harness)
      expect(
        await asyncCodeOf(() =>
          service.decide({ validationId: attempt.validationId, decision: 'waive', by: 'dot' })
        )
      ).toBe('autopilot_validation_decision_not_owned')
      expect(status(attempt.taskId)).toBe('blocked')
      origin = 'dot'
      await service.decide({ validationId: attempt.validationId, decision: 'waive', by: 'dot' })
      expect(validation(attempt.validationId)?.waiver).toBe('dot')
      expect(announced().body).toContain('was waived from dot')
    })
  })
})

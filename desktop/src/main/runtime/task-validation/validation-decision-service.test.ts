import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchValidationListDecisionsResultSchema } from '../../../shared/rpc-contract/workbench-validation-decision-params'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import { getTaskValidationStore } from '../orchestration/db/task-validation-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { MessageRow } from '../orchestration/types'
import type { AttemptWorktree } from '../task-execution/attempt-worktree'
import type { WorktreeChangeFacts } from '../task-execution/task-result-notice'
import type { WorkflowRunOrigin } from '../workflow-run/workflow-run-origin'
import {
  FIXTURE_OWN_WORKTREE,
  FIXTURE_REASON,
  inconclusiveAttempt
} from './validation-decision.test-fixture'
import {
  createValidationDecisionService,
  type ValidationDecisionService
} from './validation-decision-service'

const NOW = new Date('2026-10-06T08:00:00.000Z')
const PRIMARY_ROUTE = {
  target: 'claude_primary',
  model: null,
  policyLevel: 'inherit',
  cliSetting: null
} as const
const STILL_RUNNING =
  'A process of this attempt may still be running; wait until it has ended before merging or keeping its changes.'

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
  let changes: WorktreeChangeFacts
  let gitReads: AttemptWorktree[]
  let service: ValidationDecisionService

  beforeEach(() => {
    harness = createAppRunHarness()
    origin = 'desktop'
    announce = vi.fn<(message: MessageRow) => void>()
    changes = { readable: true, commitsAhead: 1, uncommitted: false }
    gitReads = []
    service = createValidationDecisionService({
      owner: harness.owner,
      now: () => NOW,
      announce,
      readOrigin: () => origin,
      readWorktreeChanges: async (worktree) => {
        gitReads.push(worktree)
        return changes
      }
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

    it('describes each inconclusive result for the desktop, with the worktree of a write task', () => {
      const write = inconclusiveAttempt(harness, {
        executableEvidence: { executable: 'codex', attemptWorkspace: FIXTURE_OWN_WORKTREE }
      })
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
            executorKind: 'codex',
            model: 'gpt-6.1-sol',
            reason: FIXTURE_REASON,
            inconclusiveAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            placement: 'own_worktree',
            worktree: {
              branch: FIXTURE_OWN_WORKTREE.branch,
              path: FIXTURE_OWN_WORKTREE.path,
              baseCommit: FIXTURE_OWN_WORKTREE.baseCommit
            },
            processMayRun: false
          }
        ],
        hasMore: false
      })
    })

    it('says when a process of the attempt may still run, for the desktop to warn before a waive', () => {
      inconclusiveAttempt(harness, { tree: { verdict: 'live', method: 'root_exit_only' } })
      inconclusiveAttempt(harness, { tree: { verdict: 'unverifiable', method: 'root_exit_only' } })
      inconclusiveAttempt(harness)
      inconclusiveAttempt(harness, { executor: 'in_session', route: PRIMARY_ROUTE })
      const listed = service.listPending({ limit: 10 }).decisions
      expect(listed.map((entry) => entry.processMayRun)).toEqual([true, true, false, false])
    })

    it('shows a title with terminal and bidi controls as plain spaces', () => {
      const attempt = inconclusiveAttempt(harness)
      harness.owner.db
        .prepare('UPDATE tasks SET task_title = ? WHERE id = ?')
        .run('Fix\u202Egnp.exe\u0007probe\u2028now\u2066x', attempt.taskId)
      const [view] = service.listPending({ limit: 10 }).decisions
      expect(view?.title).toBe('Fix gnp.exe probe now x')
    })

    it('names a folder write, a read-only attempt and a task the primary kept', () => {
      inconclusiveAttempt(harness, {
        executableEvidence: { executable: 'codex', attemptWorkspace: { mode: 'folder' } }
      })
      inconclusiveAttempt(harness, {
        executableEvidence: { executable: 'codex', attemptWorkspace: { mode: 'run_workspace' } }
      })
      inconclusiveAttempt(harness, {
        executor: 'in_session',
        route: PRIMARY_ROUTE
      })
      const listed = service.listPending({ limit: 10 }).decisions
      expect(listed.map((entry) => [entry.placement, entry.executorKind, entry.worktree])).toEqual([
        ['folder', 'codex', null],
        ['run_workspace', 'codex', null],
        ['in_session', 'claude_primary', null]
      ])
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

    it('waives a write task, completes it and tells the primary to merge its branch', async () => {
      const write = inconclusiveAttempt(harness, {
        executableEvidence: { executable: 'codex', attemptWorkspace: FIXTURE_OWN_WORKTREE }
      })
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
      expect(message.body).toContain('committed on branch `nash-task-1`')
      expect(message.body).toMatch(/merge that branch into your worktree in your terminal/i)
      expect(gitReads.map((worktree) => worktree.worktreeId)).toEqual([
        FIXTURE_OWN_WORKTREE.worktreeId
      ])
      expect(service.listPending({ limit: 10 }).decisions).toEqual([])
    })

    it('reads git before the waive notice and asks for a commit first when changes are uncommitted', async () => {
      const write = inconclusiveAttempt(harness, {
        executableEvidence: { executable: 'codex', attemptWorkspace: FIXTURE_OWN_WORKTREE }
      })
      changes = { readable: true, commitsAhead: 0, uncommitted: true }
      await waive(write.validationId)
      const body = announced().body
      expect(body).toContain('uncommitted in worktree `C:/fixture/workspaces/nash-task-1`')
      expect(body).toContain('commit them there in your terminal first, then merge branch')
    })

    it('tells the primary to check before merging when git cannot be read', async () => {
      const write = inconclusiveAttempt(harness, {
        executableEvidence: { executable: 'codex', attemptWorkspace: FIXTURE_OWN_WORKTREE }
      })
      changes = { readable: false }
      await waive(write.validationId)
      expect(announced().body).toMatch(/\bcheck\b/i)
      expect(announced().body).not.toMatch(/changes are (committed|uncommitted)/)
    })

    it.each(['live', 'unverifiable'] as const)(
      'still waives while a process may run (%s), but warns instead of asking for a merge',
      async (verdict) => {
        const write = inconclusiveAttempt(harness, {
          executableEvidence: { executable: 'codex', attemptWorkspace: FIXTURE_OWN_WORKTREE },
          tree: { verdict, method: 'root_exit_only' }
        })
        expect(await waive(write.validationId)).toMatchObject({
          decision: 'waived',
          taskStatus: 'completed'
        })
        const body = announced().body
        expect(body).toContain(STILL_RUNNING)
        expect(body).not.toMatch(/merge that branch into your worktree/i)
        expect(gitReads).toEqual([])
      }
    )

    it('rejects a write task, fails it and leaves its branch for inspection without reading git', async () => {
      const write = inconclusiveAttempt(harness, {
        executableEvidence: { executable: 'codex', attemptWorkspace: FIXTURE_OWN_WORKTREE }
      })
      const outcome = await service.decide({
        validationId: write.validationId,
        decision: 'reject',
        by: 'desktop_user'
      })
      expect(outcome).toMatchObject({ decision: 'rejected', taskStatus: 'failed' })
      expect(status(write.taskId)).toBe('failed')
      expect(validation(write.validationId)?.verdict).toBe('fail')
      expect(announced().body).toContain('left for inspection; do not merge')
      expect(gitReads).toEqual([])
    })

    it('files the plain waived notice for a task the primary kept', async () => {
      const kept = inconclusiveAttempt(harness, {
        executor: 'in_session',
        route: PRIMARY_ROUTE
      })
      await waive(kept.validationId)
      expect(status(kept.taskId)).toBe('completed')
      expect(announced().body).not.toMatch(/worktree|folder|merge/i)
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

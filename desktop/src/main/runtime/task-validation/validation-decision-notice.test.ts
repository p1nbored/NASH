import { describe, expect, it } from 'vitest'
import { hasSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import {
  ATTEMPT_NOTICE_BODY_MAX_CHARS,
  AttemptNoticeSchema
} from '../orchestration/db/app-attempt-input'
import type { AttemptPlacement } from '../task-execution/attempt-workspace'
import type { WorktreeChangeFacts } from '../task-execution/task-result-notice'
import { buildDecisionNotice, decisionResultSummary } from './validation-decision-notice'

// FIXTURE_ONLY: a synthetic task, attempt and worktree; no git or mailbox is touched.
const TASK = 'task_0123456789ab'
const ATTEMPT = 'ctx_0123456789ab'
const OWN: AttemptPlacement = {
  mode: 'own_worktree',
  worktree: {
    worktreeId: 'fixture-repo::C:/fixture/workspaces/nash-task-1',
    branch: 'nash-task-1',
    path: 'C:/fixture/workspaces/nash-task-1',
    baseCommit: '0123456789abcdef0123456789abcdef01234567'
  }
}
const MERGE =
  /merge that branch into your worktree in your terminal and resolve any conflict there/i
const COMMITTED: WorktreeChangeFacts = { readable: true, commitsAhead: 1, uncommitted: false }
const STILL_RUNNING =
  'A process of this attempt may still be running; wait until it has ended before merging or keeping its changes.'

function notice(
  decision: 'waive' | 'reject',
  placement: AttemptPlacement | null,
  by: 'desktop_user' | 'dot' = 'desktop_user',
  facts: { changes?: WorktreeChangeFacts; processMayRun?: boolean } = { changes: COMMITTED }
) {
  return buildDecisionNotice({
    taskId: TASK,
    dispatchId: ATTEMPT,
    decision,
    by,
    placement,
    ...facts
  })
}

describe('validation decision notice', () => {
  it('tells the primary to merge a waived write task that ran in its own worktree', () => {
    const filed = notice('waive', OWN)
    expect(filed.subject).toBe(`Validation waived for task ${TASK}`)
    expect(filed.body).toContain('was waived by the user, so the task is completed')
    expect(filed.body).toContain(
      'committed on branch `nash-task-1` in worktree `C:/fixture/workspaces/nash-task-1`'
    )
    expect(filed.body).toMatch(MERGE)
    expect(filed.body).toContain('NASH neither merges nor removes the worktree.')
  })

  it('asks for a commit first when git showed the waived changes uncommitted', () => {
    const body =
      notice('waive', OWN, 'desktop_user', {
        changes: { readable: true, commitsAhead: 0, uncommitted: true }
      }).body ?? ''
    expect(body).toContain('uncommitted in worktree `C:/fixture/workspaces/nash-task-1`')
    expect(body).toContain('commit them there in your terminal first, then merge branch')
  })

  it('states no git fact for a waive whose worktree was not read', () => {
    const body = notice('waive', OWN, 'desktop_user', {}).body ?? ''
    expect(body).toMatch(/\bcheck\b/i)
    expect(body).not.toMatch(/changes are (committed|uncommitted)/)
  })

  it.each([OWN, { mode: 'folder' } as const])(
    'warns instead of asking for a merge when a process of the attempt may still run (%o)',
    (placement) => {
      const body = notice('waive', placement, 'desktop_user', { processMayRun: true }).body ?? ''
      expect(body).toContain('so the task is completed')
      expect(body).toContain(STILL_RUNNING)
      expect(body).not.toMatch(MERGE)
    }
  )

  it('keeps the process warning when the body falls back to the opening line', () => {
    const filed = buildDecisionNotice({
      taskId: TASK,
      dispatchId: 'sk-FIXTUREONLY1234567890abcdef',
      decision: 'waive',
      by: 'desktop_user',
      placement: { mode: 'own_worktree', worktree: { ...OWN.worktree, branch: 'nash`task' } },
      processMayRun: true
    })
    expect(AttemptNoticeSchema.safeParse(filed).success).toBe(true)
    expect(filed.body).not.toMatch(/FIXTUREONLY/)
    expect(filed.body).toContain(STILL_RUNNING)
  })

  it('leaves a rejected task branch for inspection and never asks for a merge', () => {
    const filed = notice('reject', OWN)
    expect(filed.subject).toBe(`Validation rejected for task ${TASK}`)
    expect(filed.body).toContain('was rejected by the user, so the task is failed')
    expect(filed.body).toContain('are left for inspection; do not merge anything from it')
    expect(filed.body).not.toMatch(MERGE)
  })

  it('says a waived folder write is already in the folder', () => {
    const body = notice('waive', { mode: 'folder' }).body ?? ''
    expect(body).toContain('its changes are already in the folder')
    expect(body).not.toMatch(/merge/i)
  })

  it('says a rejected folder write is still in the folder and the user decides what happens to it', () => {
    const body = notice('reject', { mode: 'folder' }).body ?? ''
    expect(body).toContain('still in the folder')
    expect(body).toMatch(/ask the user whether to keep or undo them/i)
    expect(body).not.toMatch(/merge/i)
  })

  it.each([
    ['a read-only attempt', { mode: 'run_workspace' } as const],
    ['an in-session attempt', null]
  ])('adds nothing about a workspace for %s', (_name, placement) => {
    for (const decision of ['waive', 'reject'] as const) {
      const body = notice(decision, placement).body ?? ''
      expect(body).not.toMatch(/worktree|folder|merge/i)
      expect(body).toMatch(/so the task is (completed|failed)\.$/)
    }
  })

  it('names who decided only in the opening line, so the workspace rule is the same for dot', () => {
    const byUser = notice('waive', OWN, 'desktop_user').body ?? ''
    const byDot = notice('waive', OWN, 'dot').body ?? ''
    expect(byDot).toContain('was waived from dot')
    expect(byUser.replace('by the user', 'X')).toBe(byDot.replace('from dot', 'X'))
  })

  it('points at git worktree list instead of quoting a branch it cannot quote safely', () => {
    const unsafe: AttemptPlacement = {
      mode: 'own_worktree',
      worktree: { ...OWN.worktree, branch: 'nash`task' }
    }
    const body = notice('waive', unsafe).body ?? ''
    expect(body).toContain('`git worktree list`')
    expect(body).not.toContain('nash`task')
    expect(body).toMatch(MERGE)
  })

  it('stays one bounded English notice with no secret shape, as the store requires', () => {
    for (const decision of ['waive', 'reject'] as const) {
      for (const placement of [OWN, { mode: 'folder' } as const, null]) {
        const filed = notice(decision, placement, 'dot')
        expect(AttemptNoticeSchema.safeParse(filed).success).toBe(true)
        expect((filed.body ?? '').length).toBeLessThanOrEqual(ATTEMPT_NOTICE_BODY_MAX_CHARS)
        expect(hasSecretLikeText(`${filed.subject} ${filed.body}`)).toBe(false)
      }
    }
  })

  it('records a short result line that names the decider in words', () => {
    expect(decisionResultSummary('waive', 'desktop_user')).toBe('Validation waived by the user.')
    expect(decisionResultSummary('reject', 'desktop_user')).toBe('Validation rejected by the user.')
    expect(decisionResultSummary('waive', 'dot')).toBe('Validation waived from dot.')
  })
})

// FIXTURE_ONLY: synthetic ids; the notices are checked as text only.
import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../../../shared/english-text'
import { AttemptNoticeSchema } from '../orchestration/db/app-attempt-input'
import {
  attemptNotice,
  attemptWorkspaceNotice,
  isQuotable,
  type AttemptNoticeEvent,
  type WorkspaceNoticeOutcome,
  type WorktreeChangeFacts
} from './task-result-notice'

const CONTEXT = {
  taskId: 'task_0123456789ab',
  dispatchId: 'ctx_0123456789ab',
  executor: 'codex_cli',
  cliCommand: 'orca'
} as const

const EVENTS: readonly AttemptNoticeEvent[] = [
  { kind: 'claimed', secretLike: false },
  { kind: 'claimed', secretLike: true },
  { kind: 'failed', reason: 'nonzero_exit' },
  { kind: 'blocked', latch: 'quota' },
  { kind: 'blocked', latch: 'auth' },
  { kind: 'stopped', reason: 'stop_requested' },
  { kind: 'stop_unknown', reason: 'app_quit' },
  { kind: 'start_failed', reason: 'executable_not_found' },
  { kind: 'start_unknown', reason: 'app_restarted' }
]

describe('attemptNotice', () => {
  it.each(EVENTS)('writes an English mailbox notice that fits the mailbox schema (%o)', (event) => {
    const notice = attemptNotice(CONTEXT, event)
    expect(AttemptNoticeSchema.safeParse(notice).success).toBe(true)
    expect(isEnglishText(notice.subject)).toBe(true)
    expect(isEnglishText(notice.body ?? '')).toBe(true)
    expect(notice.subject).toContain(CONTEXT.taskId)
    expect(notice.body).toContain(CONTEXT.dispatchId)
  })

  it('points a claim at task-show and says the task waits for validation, never that it is complete', () => {
    const notice = attemptNotice(CONTEXT, { kind: 'claimed', secretLike: false })
    expect(notice.body).toContain('`orca orchestration task-show --task task_0123456789ab --json`')
    expect(notice.body).toMatch(/validation/i)
    expect(notice.body).not.toMatch(/\bcompleted\b/i)
    expect(notice.body).not.toMatch(/secret/i)
  })

  it('warns that a secret-shaped result is shown masked', () => {
    const notice = attemptNotice(CONTEXT, { kind: 'claimed', secretLike: true })
    expect(notice.body).toMatch(/secret/i)
    expect(notice.body).toMatch(/masked/i)
  })

  it('names the executor in words', () => {
    expect(attemptNotice(CONTEXT, { kind: 'failed', reason: 'nonzero_exit' }).body).toContain(
      'Codex CLI'
    )
    expect(
      attemptNotice({ ...CONTEXT, executor: 'agy_cli' }, { kind: 'failed', reason: 'x' }).body
    ).toContain('agy CLI')
  })

  it('says a blocked route stays unavailable and is not replaced', () => {
    const notice = attemptNotice(CONTEXT, { kind: 'blocked', latch: 'quota' })
    expect(notice.body).toMatch(/quota/)
    expect(notice.body).toMatch(/unavailable/)
  })

  it.each([
    { kind: 'stop_unknown', reason: 'app_quit' },
    { kind: 'start_unknown', reason: 'app_restarted' }
  ] as const)('says nothing is retried when the process state is unknown (%o)', (event) => {
    expect(attemptNotice(CONTEXT, event).body).toMatch(/nothing is retried/i)
  })

  it('refuses a CLI name that is not one bare word', () => {
    expect(() =>
      attemptNotice({ ...CONTEXT, cliCommand: 'orca; rm' }, { kind: 'stopped', reason: 'x' })
    ).toThrow()
  })
})

describe('attemptWorkspaceNotice (D-025 merge rule)', () => {
  const WORKTREE = {
    worktreeId: 'fixture-repo::C:/fixture/workspaces/nash-task-1',
    branch: 'nash-task_0123456789ab-ctx_0123456789ab',
    path: 'C:/fixture/workspaces/nash-task_0123456789ab-ctx_0123456789ab',
    baseCommit: '0123456789abcdef0123456789abcdef01234567'
  }
  const OWN = { mode: 'own_worktree', worktree: WORKTREE } as const
  const COMMITTED: WorktreeChangeFacts = { readable: true, commitsAhead: 2, uncommitted: false }
  const notice = (
    placement: Parameters<typeof attemptWorkspaceNotice>[0]['placement'],
    verdict: WorkspaceNoticeOutcome,
    changes: WorktreeChangeFacts | undefined = COMMITTED,
    processMayRun = false
  ) =>
    attemptWorkspaceNotice({
      placement,
      verdict,
      dispatchId: CONTEXT.dispatchId,
      changes,
      processMayRun
    })
  const MERGE_STEP = /merge that branch into your worktree in your terminal/i
  const STILL_RUNNING =
    'A process of this attempt may still be running; wait until it has ended before merging or keeping its changes.'

  it('tells the primary to merge the branch itself in its terminal when the task passed', () => {
    const text = notice(OWN, 'pass') ?? ''
    expect(isEnglishText(text)).toBe(true)
    expect(text).toMatch(/passed/)
    expect(text).toContain(`\`${WORKTREE.branch}\``)
    expect(text).toContain(`\`${WORKTREE.path}\``)
    expect(text).toMatch(MERGE_STEP)
    expect(text).toMatch(/resolve any conflict there/i)
    expect(text.length).toBeLessThanOrEqual(1000)
  })

  it.each(['pass', 'waived'] as const)(
    'says the changes are committed only when git showed commits and nothing uncommitted (%s)',
    (verdict) => {
      const text = notice(OWN, verdict) ?? ''
      expect(text).toContain(`Its changes are committed on branch \`${WORKTREE.branch}\``)
      expect(text).toMatch(MERGE_STEP)
      expect(text).not.toMatch(/uncommitted|nothing to merge/)
    }
  )

  it('asks for a commit in the worktree first when the changes are uncommitted', () => {
    const text = notice(OWN, 'pass', { readable: true, commitsAhead: 0, uncommitted: true }) ?? ''
    expect(isEnglishText(text)).toBe(true)
    expect(text).toContain(`uncommitted in worktree \`${WORKTREE.path}\``)
    expect(text).toContain(
      `commit them there in your terminal first, then merge branch \`${WORKTREE.branch}\``
    )
    expect(text).not.toMatch(/changes are committed/)
    expect(text.length).toBeLessThanOrEqual(1000)
  })

  it('names both kinds when some changes are committed and others are not', () => {
    const text = notice(OWN, 'waived', { readable: true, commitsAhead: 3, uncommitted: true }) ?? ''
    expect(text).toMatch(/committed on branch/)
    expect(text).toMatch(/uncommitted in worktree/)
    expect(text).toMatch(/commit them there in your terminal first/)
  })

  it('says there is nothing to merge when the worktree has no changes at all', () => {
    const text = notice(OWN, 'pass', { readable: true, commitsAhead: 0, uncommitted: false }) ?? ''
    expect(text).toContain('The worktree has no changes; there is nothing to merge')
    expect(text).not.toMatch(MERGE_STEP)
  })

  it.each([{ readable: false } as const, undefined])(
    'tells the primary to check before merging, never stating a fact, when git was not read (%o)',
    (changes) => {
      const text =
        attemptWorkspaceNotice({
          placement: OWN,
          verdict: 'pass',
          dispatchId: CONTEXT.dispatchId,
          changes
        }) ?? ''
      expect(isEnglishText(text)).toBe(true)
      expect(text).toMatch(/\bcheck\b/i)
      expect(text).toMatch(/before you merge/)
      expect(text).not.toMatch(/changes are (committed|uncommitted)|nothing to merge/)
      expect(text).toContain(`\`${WORKTREE.branch}\``)
    }
  )

  it.each(['pass', 'waived'] as const)(
    'replaces the merge step with a wait when a process of the attempt may still run (%s)',
    (verdict) => {
      const own = notice(OWN, verdict, undefined, true) ?? ''
      expect(own).toContain(STILL_RUNNING)
      expect(own).not.toMatch(MERGE_STEP)
      expect(own).not.toMatch(/changes are (committed|uncommitted)/)
      const folder = notice({ mode: 'folder' }, verdict, undefined, true) ?? ''
      expect(folder).toContain(STILL_RUNNING)
      expect(folder).not.toMatch(/already in the folder/)
    }
  )

  it('keeps a rejected branch for inspection whatever the process state', () => {
    const text = notice(OWN, 'rejected', undefined, true) ?? ''
    expect(text).toMatch(/left for inspection/)
    expect(text).not.toContain(STILL_RUNNING)
  })

  it.each(['fail', 'inconclusive'] as const)(
    'leaves the branch for inspection and says nothing is merged when the task did not pass (%s)',
    (verdict) => {
      const text = notice(OWN, verdict) ?? ''
      expect(isEnglishText(text)).toBe(true)
      expect(text).toContain(`\`${WORKTREE.branch}\``)
      expect(text).toMatch(/left for inspection/)
      expect(text).toMatch(/do not merge/i)
      expect(text).not.toMatch(/merge that branch into your worktree/i)
    }
  )

  it.each(['pass', 'fail', 'inconclusive'] as const)(
    'says the changes of a folder workspace task are already in the folder (%s)',
    (verdict) => {
      const text = notice({ mode: 'folder' }, verdict) ?? ''
      expect(isEnglishText(text)).toBe(true)
      expect(text).toMatch(/already in the folder/)
      expect(text).not.toMatch(/merge that branch/i)
    }
  )

  it('adds nothing for a read-only attempt or one recorded before D-025', () => {
    expect(notice({ mode: 'run_workspace' }, 'pass')).toBeNull()
    expect(notice(null, 'pass')).toBeNull()
  })

  it.each([
    { ...WORKTREE, branch: 'odd`branch' },
    { ...WORKTREE, path: `C:/fixture/${'x'.repeat(1200)}` },
    { ...WORKTREE, path: 'C:/fixture/sk-FIXTUREONLY1234567890abcdef' },
    { ...WORKTREE, branch: 'nash-\u202Ekcab' },
    { ...WORKTREE, path: 'C:/fixture/nash\u2028next-line' }
  ])('names no branch or path it cannot quote safely, and points at git instead', (worktree) => {
    const text = notice({ mode: 'own_worktree', worktree }, 'pass') ?? ''
    expect(text).not.toContain(worktree.path)
    expect(text).not.toContain(worktree.branch)
    expect(text).not.toMatch(/FIXTUREONLY/)
    expect(text).toContain(CONTEXT.dispatchId)
    expect(text).toContain('`git worktree list`')
    expect(text).toMatch(/merge that branch into your worktree in your terminal/i)
    expect(text.length).toBeLessThanOrEqual(1000)
  })

  it.each([
    ['a right-to-left override', 'nash-\u202Ekcab'],
    ['a first-strong isolate', 'nash-\u2068task'],
    ['a line separator', 'nash\u2028task'],
    ['a paragraph separator', 'nash\u2029task']
  ])('refuses to quote a name with %s', (_label, name) => {
    expect(isQuotable(name)).toBe(false)
    expect(isQuotable('nash-task-1')).toBe(true)
  })
})

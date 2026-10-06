import { hasDisplayControls } from '../../../shared/display-control-characters'
import { autopilotCliInvocation } from '../../../shared/workflow-run/autopilot-cli-commands'
import type { LatchKind } from '../../routing-table/availability/route-availability-types'
import { hasSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import type { AttemptNotice } from '../orchestration/db/app-attempt-input'
import type { AttemptPlacement } from './attempt-workspace'
import type { AttemptWorktree } from './attempt-worktree'

// The English notices an attempt leaves in the run mailbox. They point at task-show and never carry
// the executor's own output, which stays in the run directory behind the redacting reader (D-016).

export type NoticeExecutor = 'codex_cli' | 'agy_cli'

export type AttemptNoticeContext = {
  readonly taskId: string
  readonly dispatchId: string
  readonly executor: NoticeExecutor
  readonly cliCommand: string
}

export type AttemptNoticeEvent =
  | { readonly kind: 'claimed'; readonly secretLike: boolean }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'blocked'; readonly latch: LatchKind }
  | { readonly kind: 'stopped'; readonly reason: string }
  | { readonly kind: 'stop_unknown'; readonly reason: string }
  | { readonly kind: 'start_failed'; readonly reason: string }
  | { readonly kind: 'start_unknown'; readonly reason: string }

export const EXECUTOR_NAMES: Readonly<Record<NoticeExecutor, string>> = {
  codex_cli: 'Codex CLI',
  agy_cli: 'agy CLI'
}

const BLOCK_CAUSES: Readonly<Record<LatchKind, string>> = {
  quota: 'a quota limit',
  auth: 'an authentication failure'
}

const UNKNOWN_TAIL = 'Nothing is retried; the user decides how to continue.'

/** `orca orchestration task-show --task <id> --json`, the one place a result is read. */
export function taskShowCommand(cliCommand: string, taskId: string): string {
  return `${autopilotCliInvocation(cliCommand, 'task-show')} --task ${taskId} --json`
}

function subjectOf(taskId: string, event: AttemptNoticeEvent): string {
  switch (event.kind) {
    case 'claimed':
      return `Task ${taskId}: attempt finished, validation pending`
    case 'failed':
      return `Task ${taskId}: attempt failed`
    case 'blocked':
      return `Task ${taskId}: attempt blocked by ${event.latch === 'quota' ? 'quota' : 'authentication'}`
    case 'stopped':
      return `Task ${taskId}: attempt stopped`
    case 'stop_unknown':
      return `Task ${taskId}: stop not proven`
    case 'start_failed':
      return `Task ${taskId}: attempt could not start`
    case 'start_unknown':
      return `Task ${taskId}: start outcome unknown`
  }
}

function bodyOf(attempt: string, show: string, event: AttemptNoticeEvent): string {
  switch (event.kind) {
    case 'claimed':
      return [
        `${attempt} reports that it finished. The task stays blocked, waiting for validation; the result is not accepted until a validator decides.`,
        `Read the bounded, redacted result with \`${show}\`.`,
        ...(event.secretLike
          ? ['The result contains text shaped like a secret; task-show shows it masked.']
          : [])
      ].join(' ')
    case 'failed':
      return `${attempt} failed (\`${event.reason}\`). The task is failed; start it again with task-start or plan around it. Details: \`${show}\`.`
    case 'blocked':
      return `${attempt} stopped on ${BLOCK_CAUSES[event.latch]} (${event.latch}). The route stays unavailable until a fresh availability check passes, and no other model or executor is used in its place. The task is failed.`
    case 'stopped':
      return `${attempt} was stopped (\`${event.reason}\`), and no process of it is left. Read the task state with \`${show}\`.`
    case 'stop_unknown':
      return `${attempt} ended (\`${event.reason}\`) without proof that its process tree exited, so a process may still run. ${UNKNOWN_TAIL}`
    case 'start_failed':
      return `${attempt} could not start (\`${event.reason}\`), and nothing ran. The task is failed; start it again with task-start once the cause is fixed.`
    case 'start_unknown':
      return `${attempt} was still starting when the app stopped (\`${event.reason}\`), so whether a process started is unknown. ${UNKNOWN_TAIL}`
  }
}

/** Longest branch or path a notice quotes; past it the notice points at `git worktree list` instead. */
const MAX_QUOTED_CHARS = 300

/** Whether a branch or path can sit in a code span of a notice: bounded, one line, no secret shape. */
export function isQuotable(text: string): boolean {
  return (
    text.length > 0 &&
    text.length <= MAX_QUOTED_CHARS &&
    !text.includes('`') &&
    !hasDisplayControls(text) &&
    !hasSecretLikeText(text)
  )
}

/** A validator's verdict, or the user's or dot's decision on an inconclusive one. */
export type WorkspaceNoticeOutcome = 'pass' | 'fail' | 'inconclusive' | 'waived' | 'rejected'

/** What git showed in an attempt's own worktree, read by the async caller just before the notice. */
export type WorktreeChangeFacts =
  | { readonly readable: true; readonly commitsAhead: number; readonly uncommitted: boolean }
  | { readonly readable: false }

export type WorkspaceNoticeInput = {
  readonly placement: AttemptPlacement | null
  readonly verdict: WorkspaceNoticeOutcome
  readonly dispatchId: string
  /** For a pass or waive in its own worktree; absent or unreadable, the notice states no git fact. */
  readonly changes?: WorktreeChangeFacts
  /** The attempt's tree verdict is live or unverifiable: nothing is merged or kept until it ends. */
  readonly processMayRun?: boolean
}

export const PROCESS_MAY_STILL_RUN =
  'A process of this attempt may still be running; wait until it has ended before merging or keeping its changes.'
const MERGE_STEP =
  'Merge that branch into your worktree in your terminal and resolve any conflict there. NASH neither merges nor removes the worktree.'
const NO_MERGE_BY_NASH = 'NASH neither merges nor removes the worktree.'

type WorktreeNames = { readonly branch: string; readonly worktree: string; readonly both: string }

function namesOf(worktree: AttemptWorktree, dispatchId: string): WorktreeNames {
  if (isQuotable(worktree.branch) && isQuotable(worktree.path)) {
    const branch = `branch \`${worktree.branch}\``
    const where = `worktree \`${worktree.path}\``
    return { branch, worktree: where, both: `${branch} in ${where}` }
  }
  const where = `its own worktree, named after attempt \`${dispatchId}\` (\`git worktree list\` shows it)`
  return { branch: "that worktree's branch", worktree: where, both: `the branch of ${where}` }
}

/** The merge step stated from what git showed; with no reading, an instruction to check instead. */
function mergeLine(names: WorktreeNames, changes: WorktreeChangeFacts | undefined): string {
  if (!changes?.readable) {
    return `NASH could not read git in ${names.worktree}. Check in your terminal that the task's work is committed on ${names.branch} before you merge that branch into your worktree, and resolve any conflict there. ${NO_MERGE_BY_NASH}`
  }
  const commitFirst = `commit them there in your terminal first, then merge ${names.branch} into your worktree and resolve any conflict there. ${NO_MERGE_BY_NASH}`
  if (changes.uncommitted) {
    return changes.commitsAhead > 0
      ? `Some of its changes are committed on ${names.branch}, and others are uncommitted in ${names.worktree}; ${commitFirst}`
      : `Its changes are uncommitted in ${names.worktree}; ${commitFirst}`
  }
  return changes.commitsAhead > 0
    ? `Its changes are committed on ${names.both}. ${MERGE_STEP}`
    : `The worktree has no changes; there is nothing to merge from ${names.both}. NASH does not remove the worktree.`
}

function ownWorktreeLine(worktree: AttemptWorktree, input: WorkspaceNoticeInput): string {
  const names = namesOf(worktree, input.dispatchId)
  if (input.verdict !== 'pass' && input.verdict !== 'waived') {
    return `Its changes on ${names.both} are left for inspection; do not merge anything from it.`
  }
  // Why no "passed" for a waive: a waived task is accepted as done without a passing validation.
  const opening = input.verdict === 'pass' ? 'The task passed. ' : ''
  return input.processMayRun
    ? `${opening}It ran on ${names.both}. ${PROCESS_MAY_STILL_RUN} ${NO_MERGE_BY_NASH}`
    : `${opening}${mergeLine(names, input.changes)}`
}

function folderLine(outcome: WorkspaceNoticeOutcome, processMayRun: boolean): string {
  switch (outcome) {
    case 'pass':
    case 'waived':
      return processMayRun
        ? `The task wrote in the folder workspace itself. ${PROCESS_MAY_STILL_RUN}`
        : 'The task wrote in the folder workspace itself, so its changes are already in the folder.'
    case 'rejected':
      return 'The task wrote in the folder workspace itself, so the changes it made are still in the folder although the task was rejected. Ask the user whether to keep or undo them before you go on.'
    default:
      return 'The task wrote in the folder workspace itself, so any changes it made are already in the folder; review them there.'
  }
}

/**
 * D-025 merge rule: what the primary does with a writing task's changes once validation, the user
 * or dot decided. Null for an attempt that wrote nothing of its own (read-only, or before D-025).
 */
export function attemptWorkspaceNotice(input: WorkspaceNoticeInput): string | null {
  switch (input.placement?.mode) {
    case 'own_worktree':
      return ownWorktreeLine(input.placement.worktree, input)
    case 'folder':
      return folderLine(input.verdict, input.processMayRun === true)
    default:
      return null
  }
}

/** One mailbox notice for one attempt event; English only, with ids in backticks. */
export function attemptNotice(
  context: AttemptNoticeContext,
  event: AttemptNoticeEvent
): AttemptNotice {
  const show = taskShowCommand(context.cliCommand, context.taskId)
  const attempt = `The ${EXECUTOR_NAMES[context.executor]} attempt \`${context.dispatchId}\` of task \`${context.taskId}\``
  return { subject: subjectOf(context.taskId, event), body: bodyOf(attempt, show, event) }
}

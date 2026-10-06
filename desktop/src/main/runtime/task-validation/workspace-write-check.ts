import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { mapWithConcurrency } from '../../../shared/map-with-concurrency'
import type { EvidenceRef } from '../orchestration/db/task-validation-record'
import {
  failed,
  passed,
  undecided,
  type AttemptEvidence,
  type CheckOutcome
} from './validation-context'

// With no pre-attempt snapshot, a change counts as the attempt's when modified at or after its start.

const NO_WORKSPACE_WRITES = 'no_workspace_writes'
// Why a bound: `git status --untracked-files=all` can list thousands of files.
const LSTAT_CONCURRENCY = 16

export type WorkspaceGitStatus =
  | {
      readonly ok: true
      /** Absolute paths of every changed, staged or untracked file git reports. */
      readonly changedFiles: readonly string[]
      /** Committer time of HEAD in whole seconds, or null for a repository without commits. */
      readonly headCommitSeconds: number | null
    }
  | { readonly ok: false; readonly reason: 'not_a_repository' | 'git_failed' }

/** Implemented over Orca's git runner (workspace-git-status.ts); git is never spawned directly. */
export type WorkspaceGitPort = {
  readStatus(workspacePath: string, signal?: AbortSignal): Promise<WorkspaceGitStatus>
}

type Dated = 'before' | 'during' | 'unknown'

async function dateChange(path: string, startedAtMs: number): Promise<Dated> {
  try {
    const stats = await lstat(path)
    return stats.mtimeMs >= startedAtMs ? 'during' : 'before'
  } catch {
    return 'unknown'
  }
}

function statusDigest(status: {
  changedFiles: readonly string[]
  headCommitSeconds: number | null
}): string {
  const content = JSON.stringify({
    head: status.headCommitSeconds,
    files: [...status.changedFiles].sort()
  })
  return createHash('sha256').update(content).digest('hex')
}

/** A commit time is whole seconds, so any part of its second at or after the start counts as during. */
function committedDuring(headCommitSeconds: number | null, startedAtMs: number): boolean {
  return headCommitSeconds !== null && headCommitSeconds * 1000 + 999 >= startedAtMs
}

function preconditionProblem(evidence: AttemptEvidence): CheckOutcome | null {
  if (!evidence.workspace) {
    return undecided(
      NO_WORKSPACE_WRITES,
      'The workspace is not a local directory the validators can read.'
    )
  }
  if (evidence.workspace.kind === 'folder') {
    return undecided(NO_WORKSPACE_WRITES, 'A folder workspace has no git status to compare.')
  }
  if (evidence.startedAtMs === null) {
    return undecided(
      NO_WORKSPACE_WRITES,
      'The start of the attempt is not recorded, so no change can be dated.'
    )
  }
  if (evidence.executor?.treeVerdict === 'live') {
    return undecided(
      NO_WORKSPACE_WRITES,
      'A process of the attempt may still be running and writing.'
    )
  }
  return null
}

/** Attributes each uncommitted change to the attempt, or not, by when it was last written. */
async function attributeChanges(
  changedFiles: readonly string[],
  startedAtMs: number,
  evidenceRefs: readonly EvidenceRef[]
): Promise<CheckOutcome> {
  const dated = await mapWithConcurrency(changedFiles, LSTAT_CONCURRENCY, (path) =>
    dateChange(path, startedAtMs)
  )
  const during = dated.filter((when) => when === 'during').length
  if (during > 0) {
    const subject =
      during === 1
        ? '1 changed path in the workspace was'
        : `${during} changed paths in the workspace were`
    return failed(NO_WORKSPACE_WRITES, `${subject} written during the attempt.`, evidenceRefs)
  }
  if (dated.includes('unknown')) {
    return undecided(
      NO_WORKSPACE_WRITES,
      'The workspace has a change, such as a deletion, that cannot be dated.',
      evidenceRefs
    )
  }
  return passed(
    NO_WORKSPACE_WRITES,
    dated.length === 0
      ? 'The workspace has no uncommitted changes.'
      : `The workspace has ${dated.length} uncommitted changes, all older than the attempt.`,
    evidenceRefs
  )
}

export async function checkNoWorkspaceWrites(
  evidence: AttemptEvidence,
  git: WorkspaceGitPort,
  signal?: AbortSignal
): Promise<CheckOutcome> {
  const problem = preconditionProblem(evidence)
  const { workspace, startedAtMs } = evidence
  if (problem || !workspace || startedAtMs === null) {
    return problem ?? undecided(NO_WORKSPACE_WRITES, 'The workspace is unknown.')
  }
  const status = await git.readStatus(workspace.path, signal)
  if (!status.ok) {
    return undecided(
      NO_WORKSPACE_WRITES,
      status.reason === 'not_a_repository'
        ? 'The workspace is not a git repository.'
        : 'Git could not report the workspace status.'
    )
  }
  const evidenceRefs = [{ kind: 'workspace_status', ref: statusDigest(status) }]
  if (committedDuring(status.headCommitSeconds, startedAtMs)) {
    return failed(
      NO_WORKSPACE_WRITES,
      'A commit was made in the workspace during the attempt.',
      evidenceRefs
    )
  }
  return attributeChanges(status.changedFiles, startedAtMs, evidenceRefs)
}

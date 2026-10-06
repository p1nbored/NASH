import { z } from 'zod'
import { workspaceKindForWorktreeId } from '../../../shared/workspace-launch-kind'
import type { JsonObject } from '../orchestration/db/autopilot-json-column'
import {
  attemptWorktreeRefusal,
  type AttemptWorktree,
  type AttemptWorktreePort
} from './attempt-worktree'
import type { ProcessAttemptPlan, TaskExecutorKind } from './process-executor-contract'

// D-025: where a Codex or agy attempt runs. A read-only attempt runs in the run's workspace. A write
// attempt in a git workspace gets its own worktree. A folder workspace has no git, so a write attempt
// writes in the folder itself: parallel writers there are not kept apart from each other or from the
// primary, and nothing locks or refuses them.

export type AttemptPlacement =
  | { readonly mode: 'run_workspace' }
  | { readonly mode: 'folder' }
  | { readonly mode: 'own_worktree'; readonly worktree: AttemptWorktree }

export type PlacedAttempt = { readonly cwd: string; readonly placement: AttemptPlacement }

export type PlacementOutcome =
  | { readonly ok: true; readonly placed: PlacedAttempt }
  | { readonly ok: false; readonly reason: string }

/** The last launch step before an attempt is marked running; a failure means nothing ran. */
export async function placeAttempt(
  worktrees: AttemptWorktreePort,
  plan: ProcessAttemptPlan,
  executor: TaskExecutorKind,
  runWorkspacePath: string
): Promise<PlacementOutcome> {
  if (plan.access === 'read_only') {
    return { ok: true, placed: { cwd: runWorkspacePath, placement: { mode: 'run_workspace' } } }
  }
  if (workspaceKindForWorktreeId(plan.workspaceId) === 'folder') {
    return { ok: true, placed: { cwd: runWorkspacePath, placement: { mode: 'folder' } } }
  }
  try {
    const worktree = await worktrees.create({
      runWorktreeId: plan.workspaceId,
      runWorktreePath: runWorkspacePath,
      runId: plan.runId,
      taskId: plan.taskId,
      dispatchId: plan.dispatchId,
      executor
    })
    return {
      ok: true,
      placed: { cwd: worktree.path, placement: { mode: 'own_worktree', worktree } }
    }
  } catch (error) {
    return { ok: false, reason: attemptWorktreeRefusal(error) }
  }
}

/** The transcript `start` record's worktree: branch, path and base commit, or none. */
export function transcriptWorktreeOf(
  placement: AttemptPlacement
): { readonly branch: string; readonly path: string; readonly baseCommit: string } | null {
  if (placement.mode !== 'own_worktree') {
    return null
  }
  const { branch, path, baseCommit } = placement.worktree
  return { branch, path, baseCommit }
}

const PlacementEvidenceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('run_workspace') }).strict(),
  z.object({ mode: z.literal('folder') }).strict(),
  z
    .object({
      mode: z.literal('own_worktree'),
      worktreeId: z.string().min(1),
      branch: z.string().min(1),
      path: z.string().min(1),
      baseCommit: z.string().min(1)
    })
    .strict()
])

/** The `attemptWorkspace` field of the executor row's launch evidence; validation reads it back. */
export function placementEvidence(placement: AttemptPlacement): { attemptWorkspace: JsonObject } {
  return {
    attemptWorkspace:
      placement.mode === 'own_worktree'
        ? { mode: placement.mode, ...placement.worktree }
        : { mode: placement.mode }
  }
}

/** Null for an attempt recorded before D-025, an in-session attempt, or a damaged record. */
export function placementFromEvidence(evidence: JsonObject | null): AttemptPlacement | null {
  const parsed = PlacementEvidenceSchema.safeParse(evidence?.attemptWorkspace)
  if (!parsed.success) {
    return null
  }
  const record = parsed.data
  if (record.mode !== 'own_worktree') {
    return { mode: record.mode }
  }
  const { worktreeId, branch, path, baseCommit } = record
  return { mode: 'own_worktree', worktree: { worktreeId, branch, path, baseCommit } }
}

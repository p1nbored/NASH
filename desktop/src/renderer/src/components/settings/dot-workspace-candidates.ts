import {
  getKnownExecutionHostIdForWorktree,
  type WorktreeRuntimeOwnerState
} from '@/lib/worktree-runtime-owner'
import { DOT_WORKSPACE_LABEL_MAX_CHARS } from '../../../../shared/dot-ingress/dot-ingress-limits'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { Repo } from '../../../../shared/repo-types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { splitWorktreeId } from '../../../../shared/worktree/id'
import type { Worktree } from '../../../../shared/worktree/types'

/** A workspace of this app that the user may enable for dot. */
export type DotWorkspaceCandidate = {
  workspaceId: string
  label: string
  kind: 'worktree' | 'folder'
  path: string
}

/** A workspace already in the dot list: excluded by id, and its label is taken. */
export type DotListedWorkspace = { workspaceId: string; label: string }

export type DotWorkspaceCandidateState = Omit<
  WorktreeRuntimeOwnerState,
  'repos' | 'worktreesByRepo' | 'folderWorkspaces'
> & {
  repos: readonly Repo[]
  worktreesByRepo: Readonly<Record<string, readonly Worktree[]>>
  folderWorkspaces: readonly FolderWorkspace[]
}

const LABEL_FALLBACK = 'Workspace'
// Why: dot is a model that reads characters the user cannot see, such as bidi controls and tags.
const INVISIBLE = /[\p{Cf}\p{Co}\p{Cn}\p{Cs}]/gu
// Why: the stored label refuses control, line and paragraph separators and both slashes.
const UNPRINTABLE = /[\p{Cc}\p{Zl}\p{Zp}]/gu
const SLASHES = /[\\/]/g

/** Cuts at whole code points, since the cap counts UTF-16 units. */
function fitUnits(text: string, max: number): string {
  let fitted = ''
  for (const character of text) {
    if (fitted.length + character.length > max) {
      break
    }
    fitted += character
  }
  return fitted.trim()
}

/** The name dot sees for a workspace; path separators are replaced so it never reads as a path. */
export function dotWorkspaceLabel(name: string): string {
  const cleaned = name
    .replace(INVISIBLE, '')
    .replace(UNPRINTABLE, ' ')
    .replace(SLASHES, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const label = fitUnits(cleaned, DOT_WORKSPACE_LABEL_MAX_CHARS)
  return label.length > 0 ? label : LABEL_FALLBACK
}

/** The checkout path inside a worktree id; a folder key carries none. */
export function dotWorkspacePath(workspaceId: string): string | null {
  return splitWorktreeId(workspaceId)?.worktreePath ?? null
}

function isLocal(state: DotWorkspaceCandidateState, workspaceId: string): boolean {
  return getKnownExecutionHostIdForWorktree(state, workspaceId) === 'local'
}

/** dot tells workspaces apart only by label, so a repeated one gets the first free " (n)". */
function distinctLabel(label: string, taken: ReadonlySet<string>): string {
  if (!taken.has(label)) {
    return label
  }
  for (let number = 2; ; number += 1) {
    const suffix = ` (${number})`
    const numbered = `${fitUnits(label, DOT_WORKSPACE_LABEL_MAX_CHARS - suffix.length)}${suffix}`
    if (!taken.has(numbered)) {
      return numbered
    }
  }
}

function localWorktrees(
  state: DotWorkspaceCandidateState,
  listed: ReadonlySet<string>
): DotWorkspaceCandidate[] {
  const repoNames = new Map(state.repos.map((repo) => [repo.id, repo.displayName]))
  return Object.values(state.worktreesByRepo)
    .flat()
    .filter((entry) => !entry.isArchived && !listed.has(entry.id) && isLocal(state, entry.id))
    .map((entry) => {
      const repoName = repoNames.get(entry.repoId)
      const name = repoName ? `${repoName}: ${entry.displayName}` : entry.displayName
      return {
        workspaceId: entry.id,
        label: dotWorkspaceLabel(name),
        kind: 'worktree' as const,
        path: entry.path
      }
    })
}

function localFolders(
  state: DotWorkspaceCandidateState,
  listed: ReadonlySet<string>
): DotWorkspaceCandidate[] {
  return state.folderWorkspaces
    .map((entry) => ({ entry, workspaceId: folderWorkspaceKey(entry.id) }))
    .filter(
      ({ entry, workspaceId }) =>
        !entry.isArchived && !listed.has(workspaceId) && isLocal(state, workspaceId)
    )
    .map(({ entry, workspaceId }) => ({
      workspaceId,
      label: dotWorkspaceLabel(entry.name),
      kind: 'folder' as const,
      path: entry.folderPath
    }))
}

/** Local, unarchived workspaces not yet in the dot list, sorted by the distinct label dot would see. */
export function listDotWorkspaceCandidates(
  state: DotWorkspaceCandidateState,
  listedWorkspaces: readonly DotListedWorkspace[]
): DotWorkspaceCandidate[] {
  const listed = new Set(listedWorkspaces.map((entry) => entry.workspaceId))
  const taken = new Set(listedWorkspaces.map((entry) => entry.label))
  const sorted = [...localWorktrees(state, listed), ...localFolders(state, listed)].sort(
    (left, right) => left.label.localeCompare(right.label)
  )
  return sorted.map((candidate) => {
    const label = distinctLabel(candidate.label, taken)
    taken.add(label)
    return { ...candidate, label }
  })
}

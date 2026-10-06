type KnownWorktree = { readonly id: string; readonly path: string }

function comparablePath(path: string): string {
  const slashed = path.replaceAll('\\', '/').replace(/\/+$/, '')
  // Why: Windows drive paths compare without case; POSIX paths keep it.
  return /^[A-Za-z]:\//.test(slashed) ? slashed.toLowerCase() : slashed
}

/** The Orca worktree at a writing task's path, or null when this window does not know it. */
export function findWorktreeIdByPath(
  worktreesByRepo: Readonly<Record<string, readonly KnownWorktree[]>> | undefined,
  path: string
): string | null {
  const wanted = comparablePath(path)
  for (const worktrees of Object.values(worktreesByRepo ?? {})) {
    const match = worktrees.find((worktree) => comparablePath(worktree.path) === wanted)
    if (match) {
      return match.id
    }
  }
  return null
}

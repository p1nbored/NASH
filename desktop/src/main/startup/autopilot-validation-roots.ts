import { workspaceKindForWorktreeId } from '../../shared/workspace-launch-kind'
import type { ValidationRootsPort } from '../runtime/task-validation/attempt-evidence'

// Validation reads only a local workspace that the catalog still admits.

export function createValidationRoots(input: {
  /** `runtime.requireWorkbenchWorkspace`: throws for a remote, missing or ambiguous workspace. */
  readonly requireWorkspace: (workspaceId: string) => { readonly path: string }
}): ValidationRootsPort {
  return {
    resolveWorkspace: async (workspaceId) => {
      const kind = workspaceKindForWorktreeId(workspaceId)
      if (kind === 'floating') {
        return null
      }
      try {
        const { path } = input.requireWorkspace(workspaceId)
        return { path, kind: kind === 'folder' ? 'folder' : 'git' }
      } catch {
        return null
      }
    }
  }
}

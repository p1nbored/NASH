import { resolve } from 'node:path'
import { workspaceKindForWorktreeId } from '../../shared/workspace-launch-kind'
import { isPathInside } from '../agent-exec-shared/path-containment'
import type { ValidationRootsPort } from '../runtime/task-validation/attempt-evidence'
import { ATTEMPT_RUNS_FOLDER } from '../runtime/task-execution/task-execution-runtime'

// Where validation may look: a local workspace the catalog still admits, and attempt run folders
// under the app's own data folder. Anything else resolves to null, which the validators refuse.

export function createValidationRoots(input: {
  /** `runtime.requireWorkbenchWorkspace`: throws for a remote, missing or ambiguous workspace. */
  readonly requireWorkspace: (workspaceId: string) => { readonly path: string }
  readonly userDataPath: string
  readonly platform?: NodeJS.Platform
}): ValidationRootsPort {
  const platform = input.platform ?? process.platform
  const runsRoot = resolve(input.userDataPath, ATTEMPT_RUNS_FOLDER)
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
    },
    resolveRunDirectory: (relativeRunDirectory) => {
      const absolute = resolve(input.userDataPath, relativeRunDirectory)
      // Why strictly below: the runs root itself is no attempt's directory.
      const below =
        isPathInside(absolute, runsRoot, platform) && !isPathInside(runsRoot, absolute, platform)
      return below ? absolute : null
    }
  }
}

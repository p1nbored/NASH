import type { LaunchTarget } from '../../agent-exec-shared/launch-target'
import type { CodexExecutable } from '../../codex-exec/codex-exec-executable'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createAttemptReader, type ValidationRootsPort } from './attempt-evidence'
import { createAttemptWorktreeChangesReader } from './attempt-worktree-changes'
import { createClaudeReviewer } from './claude-reviewer'
import { createCodexReviewer } from './codex-reviewer'
import type { ReviewerResolverPort } from './model-review'
import { createTaskValidationPort } from './task-validation-port'
import { createValidationRunner, type ValidationRunner } from './validation-runner'
import { createWorkspaceGitPort } from './workspace-git-status'

// E1 wires this at startup; waiving or rejecting stays on the decision port, never reachable here.

export type TaskValidationRuntimePorts = {
  readonly owner: OrchestrationDb
  readonly roots: ValidationRootsPort
  /** The routing-table runtime's resolver (resolveValidationReviewer and latch). */
  readonly resolver: ReviewerResolverPort
  /** Absolute, app-private directory under userData for reviewer run directories. */
  readonly reviewRunsRoot: string
  readonly codex: {
    readonly resolveExecutable: () => CodexExecutable
  }
  readonly claude: {
    readonly resolveExecutable: () => LaunchTarget | null
    readonly electron?: { readonly isElectron: boolean; readonly execPath: string }
  }
  readonly now?: () => Date
}

export function createTaskValidationRuntime(ports: TaskValidationRuntimePorts): ValidationRunner {
  return createValidationRunner({
    port: createTaskValidationPort(ports.owner),
    reader: createAttemptReader(ports.owner, ports.roots),
    git: createWorkspaceGitPort(),
    // Why through the roots port: git is read only in a worktree the catalog still admits as local.
    readWorktreeChanges: createAttemptWorktreeChangesReader({
      resolvePath: async (worktreeId) =>
        (await ports.roots.resolveWorkspace(worktreeId))?.path ?? null
    }),
    review: {
      resolver: ports.resolver,
      runners: {
        codex_cli: createCodexReviewer({ runsRoot: ports.reviewRunsRoot, ...ports.codex }),
        claude_headless: createClaudeReviewer({ runsRoot: ports.reviewRunsRoot, ...ports.claude })
      }
    },
    now: ports.now ?? (() => new Date())
  })
}

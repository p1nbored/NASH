import type { NativeReviewerDeps } from './reviewer-runner'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createAttemptReader, type ValidationRootsPort } from './attempt-evidence'
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
  readonly reviewer: NativeReviewerDeps
  readonly now?: () => Date
}

export function createTaskValidationRuntime(ports: TaskValidationRuntimePorts): ValidationRunner {
  return createValidationRunner({
    port: createTaskValidationPort(ports.owner),
    reader: createAttemptReader(ports.owner, ports.roots),
    git: createWorkspaceGitPort(),
    review: {
      resolver: ports.resolver,
      runners: {
        codex_cli: createCodexReviewer(ports.reviewer),
        claude_headless: createClaudeReviewer(ports.reviewer)
      }
    },
    now: ports.now ?? (() => new Date())
  })
}

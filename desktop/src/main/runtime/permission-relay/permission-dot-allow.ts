import type { OrchestrationDb } from '../orchestration/db'
import type { PermissionDecisionRecord } from '../orchestration/db/permission-decision-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { isDesktopOnlyRecord } from './permission-redaction'

// RG7: a read-only run denies Edit, Write and NotebookEdit, but nothing sandboxes a shell command, so
// a command could still write. Until a verified sandbox enforces read-only commands, dot may allow
// only a read tool on a run whose recorded access is read_only; it may deny any prompt it can see.

/**
 * Tools that only read; every other tool, including an unknown one, needs a run that may write.
 * Grep is desktop-only (permission-audience.ts), so it is not listed.
 */
export const DOT_ALLOW_READ_TOOLS: readonly string[] = ['Read', 'Glob']

export const DOT_ALLOW_REFUSED_CODE = 'autopilot_permission_dot_allow_refused'

/** True when dot may answer `allow`. The access is the run's recorded one, never a caller's claim. */
export function dotMayAllow(
  db: OrchestrationDb,
  record: Pick<PermissionDecisionRecord, 'runId' | 'toolName'> &
    Partial<Pick<PermissionDecisionRecord, 'summary'>>
): boolean {
  if (
    record.summary !== undefined &&
    isDesktopOnlyRecord({ toolName: record.toolName, summary: record.summary })
  ) {
    return false
  }
  if (DOT_ALLOW_READ_TOOLS.includes(record.toolName)) {
    return true
  }
  return getWorkflowRunStore(db).get(record.runId)?.requestedAccess === 'workspace_write'
}

/** Throws before any write, so a refused allow has no effect and the prompt stays answerable. */
export function requireDotMayAllow(
  db: OrchestrationDb,
  record: Pick<PermissionDecisionRecord, 'runId' | 'toolName'>
): void {
  if (!dotMayAllow(db, record)) {
    throw new OrchestrationError(
      DOT_ALLOW_REFUSED_CODE,
      'This run may not write, so dot can deny this prompt but cannot allow it. Allow it in the app if you trust it. No effects were applied.',
      { effectsApplied: false, reason: 'run_read_only' }
    )
  }
}

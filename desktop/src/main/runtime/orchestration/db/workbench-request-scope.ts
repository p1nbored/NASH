import { createHash } from 'node:crypto'
import { z } from 'zod'
import { OrchestrationError } from '../orchestration-error'
import type { WorkbenchLocalWorkspace } from '../../workbench-local-workspace'
import {
  WorkbenchPositiveIntegerSchema,
  WorkbenchRequestIdSchema,
  WorkbenchWorkspaceIdSchema
} from '../../../../shared/workbench-request'

const MAX_PRINCIPAL_LENGTH = 512

/** One request addressed inside a caller's admitted workspace. */
export const WorkbenchRequestTargetSchema = z
  .object({ workspaceId: WorkbenchWorkspaceIdSchema, requestId: WorkbenchRequestIdSchema })
  .strict()
export const WorkbenchRevisionTargetSchema = WorkbenchRequestTargetSchema.extend({
  expectedRevision: WorkbenchPositiveIntegerSchema
}).strict()
export type WorkbenchRequestTarget = z.infer<typeof WorkbenchRequestTargetSchema>
export type WorkbenchRevisionTarget = z.infer<typeof WorkbenchRevisionTargetSchema>

/** The columns every scoped request read and write filters on. */
export type WorkbenchRequestScope = {
  principalId: string
  workspaceId: string
  workspaceBinding: string
}

export function requireWorkbenchPrincipal(principalId: string): void {
  if (!principalId.trim() || principalId.length > MAX_PRINCIPAL_LENGTH) {
    throw new OrchestrationError(
      'workbench_forbidden',
      'Authenticated Workbench caller is required.'
    )
  }
}

/** Hash of the admitted workspace, so a remapped project no longer matches stored requests. */
export function workbenchWorkspaceBinding(
  workspaceId: string,
  workspace: WorkbenchLocalWorkspace
): string {
  if (
    workspace.workspaceId !== workspaceId ||
    workspace.hostId !== 'local' ||
    !workspace.projectId ||
    !workspace.path
  ) {
    throw new OrchestrationError(
      'workbench_workspace_unavailable',
      'The admitted workspace scope is inconsistent.'
    )
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId: workspace.workspaceId,
        projectId: workspace.projectId,
        projectKind: workspace.projectKind,
        hostId: workspace.hostId,
        path: workspace.path
      })
    )
    .digest('hex')
}

export function resolveWorkbenchRequestScope(
  principalId: string,
  workspaceId: string,
  workspace: WorkbenchLocalWorkspace
): WorkbenchRequestScope {
  requireWorkbenchPrincipal(principalId)
  return {
    principalId,
    workspaceId,
    workspaceBinding: workbenchWorkspaceBinding(workspaceId, workspace)
  }
}

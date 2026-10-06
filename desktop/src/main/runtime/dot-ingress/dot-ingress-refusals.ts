import {
  dotIngressErrorMessageV3,
  type DotIngressErrorCodeV3
} from '../../../shared/dot-ingress/dot-ingress-errors-v3'
import { DOT_INGRESS_PRINCIPAL_ID } from '../../../shared/dot-ingress/dot-ingress-limits'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { workbenchWorkspaceBinding } from '../orchestration/db/workbench-request-scope'
import { getWorkbenchRequestStore } from '../orchestration/db/workbench-request-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { WorkbenchIntakeTarget } from '../workbench-intake-submit'
import type { WorkbenchLocalWorkspace } from '../workbench-local-workspace'
import type { DotIngressServiceDeps } from './dot-ingress-ports'

/** A contract error with its fixed English message; data carries codes and names, never request text. */
export function dotRefusal(
  code: DotIngressErrorCodeV3,
  data?: Record<string, unknown>
): OrchestrationError {
  return new OrchestrationError(code, dotIngressErrorMessageV3(code), data)
}

/** Off means off: every dot call but hello is refused while the user has the interface switched off. */
export function requireDotInterfaceOn(db: OrchestrationDb): void {
  if (!getDotIngressSettingsStore(db).getSettings().enabled) {
    throw dotRefusal('dot_ingress_disabled')
  }
}

export function orchestrationCodeOf(error: unknown): string | null {
  return error instanceof OrchestrationError ? error.code : null
}

export type AdmittedDotWorkspace = { workspace: WorkbenchLocalWorkspace; binding: string }

/**
 * Re-admits the workspace through the app's catalog, as a desktop submit does. A refusal (gone, remote,
 * ambiguous) becomes dot_workspace_unavailable; an unexpected failure is not translated.
 */
export function admitDotWorkspace(
  deps: Pick<DotIngressServiceDeps, 'requireWorkspace'>,
  workspaceId: string
): AdmittedDotWorkspace {
  try {
    const workspace = deps.requireWorkspace(workspaceId)
    return { workspace, binding: workbenchWorkspaceBinding(workspaceId, workspace) }
  } catch (error) {
    if (error instanceof OrchestrationError) {
      throw dotRefusal('dot_workspace_unavailable')
    }
    throw error
  }
}

/** The door target: dot requests are always filed under the dot principal, never the desktop one. */
export function dotIntakeTarget(
  db: OrchestrationDb,
  workspace: WorkbenchLocalWorkspace
): WorkbenchIntakeTarget {
  return {
    owner: db,
    store: getWorkbenchRequestStore(db),
    principalId: DOT_INGRESS_PRINCIPAL_ID,
    workspace
  }
}

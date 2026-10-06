import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getWorkbenchRequestStore } from '../orchestration/db/workbench-request-store'
import { cancelWorkbenchRequest } from '../workbench-intake-submit'
import type { WorkbenchLocalWorkspace } from '../workbench-local-workspace'
import { errorCodeOf } from '../workflow-run/primary-session-ports'
import { requirePrimarySessionRuntime } from '../workflow-run/primary-session-runtime'
import { stopWorkflowRunForCancel, type RunStopOutcome } from './workbench-run-stop'

type Receipt = {
  readonly principalId: string
  readonly workspaceId: string
  readonly status: string
  readonly revision: number
}

function receiptOf(owner: OrchestrationDb, requestId: string): Receipt | null {
  getWorkbenchRequestStore(owner)
  const row = owner.db
    .prepare(
      'SELECT principal_id, workspace_id, status, revision FROM workbench_requests WHERE request_id = ?'
    )
    .get(requestId)
  return row
    ? {
        principalId: String(row.principal_id),
        workspaceId: String(row.workspace_id),
        status: String(row.status),
        revision: Number(row.revision)
      }
    : null
}

/**
 * The desktop's Stop on any run, including one dot started: end the run first, then cancel its intake
 * receipt under the principal that submitted it. A receipt that cannot be reached (its workspace is
 * gone) is logged by code and left as it is; the run itself is already ended.
 */
export async function stopWorkflowRunFromDesktop(
  owner: OrchestrationDb,
  runId: string,
  workspaces: { require(workspaceId: string): WorkbenchLocalWorkspace }
): Promise<RunStopOutcome> {
  const stopped = await stopWorkflowRunForCancel(
    owner,
    runId,
    'user_canceled',
    requirePrimarySessionRuntime
  )
  const receipt = receiptOf(owner, stopped.run.requestId)
  if (receipt === null || receipt.status === 'CANCELED') {
    return stopped
  }
  try {
    await cancelWorkbenchRequest(
      {
        owner,
        store: getWorkbenchRequestStore(owner),
        principalId: receipt.principalId,
        workspace: workspaces.require(receipt.workspaceId)
      },
      {
        workspaceId: receipt.workspaceId,
        requestId: stopped.run.requestId,
        expectedRevision: receipt.revision
      }
    )
  } catch (error) {
    console.warn(`[workbench-run] run stopped, request not canceled: ${errorCodeOf(error)}`)
  }
  return stopped
}

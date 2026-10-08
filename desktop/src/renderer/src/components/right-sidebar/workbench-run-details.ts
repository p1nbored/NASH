import type {
  PrimarySessionLiveView,
  WorkflowRunView
} from '../../../../shared/workflow-run/workflow-run-view'
import { errorDetails, type WorkbenchDetail } from './workbench-details'
import type { WorkbenchError } from './workbench-rpc-error'

function liveDetail(live: PrimarySessionLiveView | null | undefined): string | null {
  if (!live) {
    return null
  }
  switch (live.kind) {
    case 'live':
      return `live/${live.activity}`
    case 'unverifiable':
      return `unverifiable/${live.reason}`
    case 'ended':
      return `ended/${live.state}`
    case 'agent_absent':
    case 'starting':
      return live.kind
  }
}

/** Everything a report about one run needs; none of it is shown in the Workbench itself. */
export function runDetails(
  run: WorkflowRunView,
  options: { liveUnread?: boolean; stopError?: WorkbenchError | null } = {}
): WorkbenchDetail[] {
  const primary = run.primary
  return [
    ['run_id', run.runId],
    ['request_id', run.requestId],
    ['workspace_id', run.workspaceId],
    ['status', run.status],
    ['origin', run.origin],
    ['access', run.requestedAccess],
    ['coordinator_agent', run.coordinator.agent],
    ['coordinator_model', run.coordinator.model],
    ['coordinator_effort', run.coordinator.effort],
    ['routing_table_version', run.routingTable.version],
    ['routing_table_sha256', run.routingTable.sha256],
    ['end_reason', run.endReason],
    ['created_at', run.createdAt],
    ['ended_at', run.endedAt],
    ['session_state', primary?.state],
    ['session_generation', primary?.generation],
    ['session_permission_mode', primary?.permissionMode],
    ['session_end_reason', primary?.endReason],
    ['session_pane', primary?.paneKey],
    ['session_live', liveDetail(primary?.live)],
    ['session_live_read_failed', options.liveUnread ? 'true' : null],
    ...errorDetails(options.stopError, 'stop')
  ]
}

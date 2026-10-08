import type { RoutingStatus } from '../../../../shared/clef/clef-route-contract'
import { WorkbenchRoutingStatusViewSchema } from '../../../../shared/clef/workbench-routing-status-view'
import { WorkbenchDotIngressSettingsResultSchema } from '../../../../shared/rpc-contract/workbench-dot-ingress-params'
import { WorkbenchDotRemoteStatusViewSchema } from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { WorkflowRunListResultSchema } from '../../../../shared/workflow-run/workflow-run-view'

// Onboarding signals for the NASH checklist steps (D-038). Each reads a local answer NASH already
// gives (agent detection or a read-only desktop RPC); anything that does not parse counts as not done.

export type NashSetupSignalValues = {
  primaryCliDetected: boolean
  clefConnected: boolean
  dotConnected: boolean
  hasWorkbenchRun: boolean
}

/** Every status past the configuration gates: credentials stored, profile verified and pinned. */
const CLEF_CONNECTED_STATUSES: ReadonlySet<RoutingStatus> = new Set<RoutingStatus>([
  'ready',
  'unreachable',
  'circuit_open',
  'quota_latched'
])

export function isPrimaryCliDetected(detectedAgentIds: unknown): boolean {
  return (
    Array.isArray(detectedAgentIds) &&
    (detectedAgentIds.includes('claude') || detectedAgentIds.includes('codex'))
  )
}

export function isClefConnected(routingStatus: unknown): boolean {
  const parsed = WorkbenchRoutingStatusViewSchema.safeParse(routingStatus)
  return parsed.success && CLEF_CONNECTED_STATUSES.has(parsed.data.status)
}

/** The local dot interface is on, or a GPT Site holds a pairing. */
export function isDotConnected(localSettings: unknown, remoteStatus: unknown): boolean {
  const local = WorkbenchDotIngressSettingsResultSchema.safeParse(localSettings)
  if (local.success && local.data.enabled) {
    return true
  }
  const remote = WorkbenchDotRemoteStatusViewSchema.safeParse(remoteStatus)
  return remote.success && remote.data.pairing !== null
}

export function hasWorkbenchRun(runList: unknown): boolean {
  const parsed = WorkflowRunListResultSchema.safeParse(runList)
  return parsed.success && parsed.data.runs.length > 0
}

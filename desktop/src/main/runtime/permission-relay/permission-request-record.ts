import {
  PERMISSION_RELAY_WAIT_MS,
  type PermissionRequestInput
} from '../../../shared/rpc-contract/permission-relay-params'
import {
  getPermissionDecisionStore,
  type PermissionDecisionRecord
} from '../orchestration/db/permission-decision-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { classifyPermissionAudience, type PermissionRelayInput } from './permission-audience'
import { buildPermissionSummary } from './permission-redaction'
import { PERMISSION_RELAY_ERROR_CODES, type PermissionRelayCaller } from './permission-relay-caller'
import type { PermissionRelayDeps } from './permission-relay-types'

export function requireAutoReview(deps: PermissionRelayDeps): void {
  if (!deps.isAutoReviewEnabled()) {
    throw new OrchestrationError(
      PERMISSION_RELAY_ERROR_CODES.unavailable,
      'Automatic permission review is disabled. Answer the prompt in the terminal. No effects were applied.',
      { effectsApplied: false }
    )
  }
}

/** Summarize and deduplicate before creating a request; the service owns its live hook wait. */
export function preparePermissionRequestRecord(
  deps: PermissionRelayDeps,
  caller: PermissionRelayCaller,
  input: PermissionRequestInput,
  isAnswerable: (record: PermissionDecisionRecord, now: number) => boolean
): { record: PermissionDecisionRecord; created: boolean } | null {
  const relayInput: PermissionRelayInput = {
    toolName: input.toolName,
    agentId: input.agentId,
    cwd: input.cwd,
    toolInput: input.toolInput
  }
  const audience = classifyPermissionAudience(
    relayInput,
    deps.controlPlaneCommands,
    deps.appDataDirectories
  )
  if (audience === 'terminal_only') {
    return null
  }
  const built = buildPermissionSummary(relayInput, audience === 'desktop_only')
  if (!built) {
    throw new OrchestrationError(
      PERMISSION_RELAY_ERROR_CODES.summaryRefused,
      'The prompt could not be summarized safely, so it stays in the terminal. No effects were applied.',
      { effectsApplied: false }
    )
  }
  const now = deps.now()
  const store = getPermissionDecisionStore(deps.getDb())
  const existing = store
    .listPending(caller.runId, 200)
    .find(
      (record) =>
        record.ownerId === caller.ownerId &&
        record.agentId === (caller.dispatchId ?? null) &&
        record.requestSha256 === input.requestSha256 &&
        record.toolName === input.toolName &&
        record.summary === built.summary &&
        isAnswerable(record, now)
    )
  if (existing) {
    return { record: existing, created: false }
  }
  return {
    record: store.create({
      runId: caller.runId,
      ownerId: caller.ownerId,
      agentId: caller.dispatchId ?? null,
      toolName: input.toolName,
      summary: built.summary,
      requestSha256: input.requestSha256,
      deadlineAt: new Date(
        now + Math.min(PERMISSION_RELAY_WAIT_MS, input.waitBudgetMs)
      ).toISOString(),
      timestamp: new Date(now).toISOString()
    }),
    created: true
  }
}

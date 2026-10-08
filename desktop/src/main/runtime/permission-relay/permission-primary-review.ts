import type { WorkbenchPermissionAnswerInput } from '../../../shared/rpc-contract/permission-relay-params'
import type { OrchestrationDb } from '../orchestration/db'
import { getPermissionDecisionStore } from '../orchestration/db/permission-decision-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { OrchestrationCompatibilityCallerAuthority } from '../runtime-terminal-contracts'
import { requireDotMayAllow } from './permission-dot-allow'
import {
  PERMISSION_RELAY_ERROR_CODES,
  resolvePermissionRelayCaller
} from './permission-relay-caller'
import { requireChildAccess } from './permission-source'

export function listPrimaryPermissionRecords(
  db: OrchestrationDb,
  authority: OrchestrationCompatibilityCallerAuthority | null
) {
  const caller = resolvePermissionRelayCaller(db, authority)
  return getPermissionDecisionStore(db)
    .listPending(caller.runId, 200)
    .filter((record) => record.ownerId === caller.ownerId && record.agentId !== null)
}

export function requirePrimaryPermissionReview(
  db: OrchestrationDb,
  authority: OrchestrationCompatibilityCallerAuthority | null,
  input: WorkbenchPermissionAnswerInput
): void {
  const caller = resolvePermissionRelayCaller(db, authority)
  const record = getPermissionDecisionStore(db).get(input.decisionId)
  if (!record || record.ownerId !== caller.ownerId || record.agentId === null) {
    throw new OrchestrationError(
      PERMISSION_RELAY_ERROR_CODES.callerRefused,
      'The coordinator may only review its own child permissions.',
      { effectsApplied: false }
    )
  }
  if (input.decision === 'allow') {
    requireDotMayAllow(db, record)
    requireChildAccess(db, record)
  }
}

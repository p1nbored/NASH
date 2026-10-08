import type {
  PermissionWaitInput,
  PermissionWaitResult
} from '../../../shared/rpc-contract/permission-relay-params'
import type { OrchestrationDb } from '../orchestration/db'
import {
  getPermissionDecisionStore,
  type PermissionDecisionRecord
} from '../orchestration/db/permission-decision-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { relayWaitOutcome } from './permission-hook-output'
import { PERMISSION_RELAY_ERROR_CODES, type PermissionRelayCaller } from './permission-relay-caller'
import type { PermissionRelayWaiters } from './permission-relay-waiters'

type WaitPorts = {
  db: OrchestrationDb
  caller: PermissionRelayCaller
  now(): number
  waiters: PermissionRelayWaiters
  isSourceLive(record: PermissionDecisionRecord): boolean
}

/** One bounded long poll, fenced to the requesting CLI process and dispatch. */
export async function waitForPermissionDecision(
  ports: WaitPorts,
  input: PermissionWaitInput,
  signal?: AbortSignal
): Promise<PermissionWaitResult> {
  const { caller, waiters } = ports
  const store = getPermissionDecisionStore(ports.db)
  const record = store.get(input.decisionId)
  if (
    !record ||
    record.ownerId !== caller.ownerId ||
    record.agentId !== (caller.dispatchId ?? null)
  ) {
    throw new OrchestrationError(
      PERMISSION_RELAY_ERROR_CODES.notFound,
      'The permission prompt was not found.',
      { effectsApplied: false }
    )
  }
  const sliceEnd = ports.now() + input.waitMs
  const deadline = Date.parse(record.deadlineAt)
  waiters.enter(input.decisionId, ports.now())
  let final = false
  try {
    for (;;) {
      if (!ports.isSourceLive(record)) {
        final = true
        return { state: 'no_decision' }
      }
      const settled = relayWaitOutcome(store.get(input.decisionId), ports.now())
      if (settled) {
        final = true
        return settled
      }
      const now = ports.now()
      if (now >= sliceEnd || signal?.aborted) {
        return { state: 'pending' }
      }
      await waiters.waitForChange(
        input.decisionId,
        Math.min(sliceEnd, deadline, now + 1_000) - now,
        signal
      )
    }
  } finally {
    if (final) {
      waiters.forget(input.decisionId)
    } else {
      waiters.leave(input.decisionId, ports.now())
    }
  }
}

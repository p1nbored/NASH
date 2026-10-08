import {
  isAgentLaunchResult,
  type AgentLaunchIntent,
  type AgentLaunchResult
} from '../../../shared/agent-launch-intent'
import { computeAgentLaunchFingerprint } from '../../../shared/agent-launch-operation'
import type { AgentSessionOperationRow } from '../../../shared/agent-session-operation-ledger'
import type { AgentLaunchParams } from '../../../shared/rpc-contract/agent-launch-params'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  admitAgentLaunchOperation,
  type AgentLaunchAdmission
} from '../rpc/methods/agent-launch-replay'
import { errorCodeOf } from './primary-session-ports'

/** The caller key Orca's ledger uses for an in-process launch (`agentLaunchOperationCallerKey`). */
export const PRIMARY_LAUNCH_CALLER_KEY = 'trusted-local:runtime'

export type PrimaryLaunchParams = AgentLaunchParams & { operationId: string }

export type PrimaryLaunchAdmission =
  | {
      readonly decision: 'execute'
      readonly ledger: 'orca' | 'app_only'
      record(result: AgentLaunchResult): Promise<void>
      settle(result: AgentLaunchResult): Promise<void>
      fail(code: string): Promise<void>
    }
  | { readonly decision: 'refuse'; readonly code: string }

/** Orca's recorded answer for an operation, read without admitting anything (reconcile). */
export type PrimaryLaunchLedgerRow =
  | { readonly kind: 'succeeded'; readonly result: AgentLaunchResult }
  | { readonly kind: 'failed'; readonly code: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unavailable' }

export type PrimaryLaunchLedgerPort = {
  admit(intent: AgentLaunchIntent, operationId: string): Promise<PrimaryLaunchAdmission>
  read(operationId: string): PrimaryLaunchLedgerRow | Promise<PrimaryLaunchLedgerRow>
}

export type PrimaryLaunchLedgerDeps = {
  /** `admitAgentLaunchOperation`, bound to the runtime. */
  admit(params: PrimaryLaunchParams, fingerprint: string): Promise<AgentLaunchAdmission>
  /** The native operation row; opening its store does not require a chat host. */
  readRow(
    callerKey: string,
    operationId: string
  ):
    | AgentSessionOperationRow
    | null
    | 'unavailable'
    | Promise<AgentSessionOperationRow | null | 'unavailable'>
}

const ENTROPY = /^[0-9a-f]{32}$/
const STRUCTURED_HOST_UNSUPPORTED = 'structured_agent_session_unsupported'

/** `<13-digit ms>-<32 hex>`, the shape `parseAgentSessionOperationTimestamp` accepts. */
export function mintPrimaryLaunchOperationId(nowMs: number, entropyHex: string): string {
  const stamp = String(Math.trunc(nowMs))
  if (!/^\d{13}$/.test(stamp) || !ENTROPY.test(entropyHex)) {
    throw new Error('autopilot_launch_operation_id_invalid')
  }
  return `${stamp}-${entropyHex}`
}

/** The `agent.launch` params of the intent; the workspace path is host-set, so it is not one. */
export function primaryLaunchParams(
  intent: AgentLaunchIntent,
  operationId: string
): PrimaryLaunchParams {
  const target =
    intent.target.kind === 'existing'
      ? { kind: 'existing' as const, worktree: intent.target.worktree }
      : null
  if (target === null) {
    throw new Error('autopilot_launch_target_invalid')
  }
  const sessionOptions = Object.fromEntries(
    Object.entries(intent.sessionOptions ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
  return {
    agent: intent.agent,
    operationId,
    target,
    ...(intent.prompt ? { prompt: intent.prompt } : {}),
    ...(intent.sessionOptions ? { sessionOptions } : {}),
    ...(intent.agentArgs !== undefined ? { agentArgs: intent.agentArgs } : {}),
    ...(intent.launchSource ? { launchSource: intent.launchSource } : {})
  }
}

const NO_LEDGER = async (): Promise<void> => undefined

/**
 * The app's use of Orca's durable launch ledger: an operation runs at most once and an unknown outcome
 * is never retried. A host that cannot install the ledger leaves the launch recorded by the app only.
 */
export function createPrimaryLaunchLedger(deps: PrimaryLaunchLedgerDeps): PrimaryLaunchLedgerPort {
  return {
    async admit(intent, operationId) {
      const params = primaryLaunchParams(intent, operationId)
      let admission: AgentLaunchAdmission
      try {
        admission = await deps.admit(params, computeAgentLaunchFingerprint(params))
      } catch (error) {
        return errorCodeOf(error) === STRUCTURED_HOST_UNSUPPORTED
          ? {
              decision: 'execute',
              ledger: 'app_only',
              record: NO_LEDGER,
              settle: NO_LEDGER,
              fail: NO_LEDGER
            }
          : { decision: 'refuse', code: 'autopilot_launch_ledger_unavailable' }
      }
      if (admission.decision === 'replay') {
        return { decision: 'refuse', code: 'autopilot_launch_operation_replayed' }
      }
      if (admission.decision === 'refuse') {
        return { decision: 'refuse', code: errorCodeOf({ code: admission.refusal.code }) }
      }
      return {
        decision: 'execute',
        ledger: 'orca',
        record: (result) => admission.record(result),
        settle: (result) => admission.settle(result),
        fail: (code) => admission.fail(code)
      }
    },
    async read(operationId) {
      const row = await deps.readRow(PRIMARY_LAUNCH_CALLER_KEY, operationId)
      if (row === 'unavailable') {
        return { kind: 'unavailable' }
      }
      if (row === null) {
        return { kind: 'absent' }
      }
      const outcome = row.outcome
      switch (outcome.status) {
        case 'succeeded':
          return isAgentLaunchResult(outcome.launch)
            ? { kind: 'succeeded', result: outcome.launch }
            : { kind: 'unreadable' }
        case 'failed':
          return { kind: 'failed', code: errorCodeOf({ code: outcome.code }) }
        case 'pending':
        case 'unknown':
          return { kind: 'pending' }
      }
    }
  }
}

/** Bound to the running app: Orca's own admission and native operation store. */
export function createOrcaPrimaryLaunchLedger(
  runtime: OrcaRuntimeService
): PrimaryLaunchLedgerPort {
  return createPrimaryLaunchLedger({
    admit: (params, fingerprint) =>
      admitAgentLaunchOperation({ runtime, caller: { kind: 'local-cli' } }, params, fingerprint),
    readRow: async (callerKey, operationId) => {
      try {
        return (await runtime.openAgentSessionRecordStore()).getOperationRow(callerKey, operationId)
      } catch {
        return 'unavailable'
      }
    }
  })
}

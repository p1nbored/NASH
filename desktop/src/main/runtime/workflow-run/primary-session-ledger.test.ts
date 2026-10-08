import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeTestJournalHostDatabase } from '../../native-chat/agent-session-journal/journal-host-database-test-support'
import { openTestAgentSessionRecordStore } from '../agent-session-record-store-test-harness'
import {
  rpcContext,
  runtimeStub,
  setAgentLaunchRecordStore
} from '../rpc/methods/agent-launch.test-fixture'
import type { AgentLaunchIntent, AgentLaunchResult } from '../../../shared/agent-launch-intent'
import { computeAgentLaunchFingerprint } from '../../../shared/agent-launch-operation'
import { parseAgentSessionOperationTimestamp } from '../../../shared/agent-session-host-authority'
import type { AgentSessionOperationOutcome } from '../../../shared/agent-session-operation-ledger'
import {
  PRIMARY_LAUNCH_CALLER_KEY,
  createOrcaPrimaryLaunchLedger,
  createPrimaryLaunchLedger,
  mintPrimaryLaunchOperationId,
  primaryLaunchParams,
  type PrimaryLaunchLedgerDeps
} from './primary-session-ledger'

const ENTROPY = '0123456789abcdef0123456789abcdef'
const OPERATION_ID = mintPrimaryLaunchOperationId(Date.parse('2026-10-05T00:00:00.000Z'), ENTROPY)

const INTENT: AgentLaunchIntent = {
  agent: 'claude',
  target: { kind: 'existing', worktree: 'repo::/fixture', workspacePath: '/fixture' },
  prompt: { text: 'Plan the task.', delivery: 'submit' },
  sessionOptions: { model: 'claude-opus-5-5', effort: 'max' },
  agentArgs: "'--permission-mode' 'manual'",
  launchSource: 'workbench'
}

const RESULT: AgentLaunchResult = {
  outcome: { kind: 'terminal', handle: 'term_a', paneKey: 'tab:leaf' },
  worktreeId: 'repo::/fixture',
  receipt: {
    mode: 'terminal',
    preferred: 'terminal',
    reason: 'user_default',
    detail: 'Started a terminal.'
  },
  prompt: { delivery: 'submit', outcome: 'handed-to-terminal' }
}

function ledgerWith(overrides: Partial<PrimaryLaunchLedgerDeps>) {
  const deps: PrimaryLaunchLedgerDeps = {
    admit: vi.fn(async () => ({
      decision: 'execute' as const,
      record: vi.fn(async () => undefined),
      settle: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      attachOperationId: 'child',
      callerKey: PRIMARY_LAUNCH_CALLER_KEY
    })),
    readRow: vi.fn(() => null),
    ...overrides
  }
  return { ledger: createPrimaryLaunchLedger(deps), deps }
}

function row(outcome: AgentSessionOperationOutcome) {
  return {
    callerKey: PRIMARY_LAUNCH_CALLER_KEY,
    operationId: OPERATION_ID,
    fingerprint: 'f',
    operationTimestamp: 1,
    recordedAt: 1,
    expiresAt: 2,
    outcome
  }
}

describe('primary session launch ledger', () => {
  it('admits, records and reopens a terminal launch through the native ledger without a chat host', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'primary-native-ledger-'))
    try {
      const store = await openTestAgentSessionRecordStore(directory)
      setAgentLaunchRecordStore(store)
      const runtime = rpcContext(runtimeStub(), {}).runtime
      const ledger = createOrcaPrimaryLaunchLedger(runtime)
      const operationId = mintPrimaryLaunchOperationId(Date.now(), ENTROPY)
      const admission = await ledger.admit(INTENT, operationId)
      expect(admission).toMatchObject({ decision: 'execute', ledger: 'orca' })
      if (admission.decision !== 'execute') {
        throw new Error('The native launch was refused.')
      }
      const provisional: AgentLaunchResult = {
        ...RESULT,
        prompt: { delivery: 'submit', outcome: 'unconfirmed' }
      }
      await admission.record(provisional)
      expect(store.getOperationRow(PRIMARY_LAUNCH_CALLER_KEY, operationId)?.outcome).toMatchObject({
        status: 'succeeded',
        launch: provisional
      })
      setAgentLaunchRecordStore(await openTestAgentSessionRecordStore(directory))
      const reopened = createOrcaPrimaryLaunchLedger(runtime)
      expect(await reopened.read(operationId)).toEqual({ kind: 'succeeded', result: provisional })
      expect(store.getOperationRow(PRIMARY_LAUNCH_CALLER_KEY, operationId)?.outcome).toMatchObject({
        status: 'succeeded',
        launch: provisional
      })
      await admission.settle(RESULT)
      setAgentLaunchRecordStore(await openTestAgentSessionRecordStore(directory))
      expect(await reopened.read(operationId)).toEqual({ kind: 'succeeded', result: RESULT })
      await expect(reopened.admit(INTENT, operationId)).resolves.toEqual({
        decision: 'refuse',
        code: 'autopilot_launch_operation_replayed'
      })
    } finally {
      setAgentLaunchRecordStore(null)
      closeTestJournalHostDatabase(directory)
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("mints ids in the format Orca's launch ledger accepts", () => {
    expect(parseAgentSessionOperationTimestamp(OPERATION_ID)).toBe(
      Date.parse('2026-10-05T00:00:00.000Z')
    )
    expect(() => mintPrimaryLaunchOperationId(1, 'not-hex')).toThrow()
  })

  it('builds the agent.launch params from the intent, without the host-set workspace path', () => {
    expect(primaryLaunchParams(INTENT, OPERATION_ID)).toEqual({
      agent: 'claude',
      operationId: OPERATION_ID,
      target: { kind: 'existing', worktree: 'repo::/fixture' },
      prompt: { text: 'Plan the task.', delivery: 'submit' },
      sessionOptions: { model: 'claude-opus-5-5', effort: 'max' },
      agentArgs: "'--permission-mode' 'manual'",
      launchSource: 'workbench'
    })
  })

  it("admits through Orca's ledger with the host-computed fingerprint", async () => {
    const { ledger, deps } = ledgerWith({})
    const admission = await ledger.admit(INTENT, OPERATION_ID)
    const params = primaryLaunchParams(INTENT, OPERATION_ID)
    expect(deps.admit).toHaveBeenCalledWith(params, computeAgentLaunchFingerprint(params))
    expect(admission).toMatchObject({ decision: 'execute', ledger: 'orca' })
  })

  it('refuses a replay: a freshly minted id must never already have an answer', async () => {
    const { ledger } = ledgerWith({
      admit: vi.fn(async () => ({ decision: 'replay' as const, result: RESULT }))
    })
    await expect(ledger.admit(INTENT, OPERATION_ID)).resolves.toEqual({
      decision: 'refuse',
      code: 'autopilot_launch_operation_replayed'
    })
  })

  it("passes Orca's refusal code through", async () => {
    const { ledger } = ledgerWith({
      admit: vi.fn(async () => ({
        decision: 'refuse' as const,
        refusal: { code: 'agent_session_operation_conflict', message: 'conflict' }
      }))
    })
    await expect(ledger.admit(INTENT, OPERATION_ID)).resolves.toEqual({
      decision: 'refuse',
      code: 'agent_session_operation_conflict'
    })
  })

  it('falls back to an app-only ledger when the structured host cannot be installed', async () => {
    const { ledger } = ledgerWith({
      admit: vi.fn(async () => {
        throw new Error('structured_agent_session_unsupported')
      })
    })
    const admission = await ledger.admit(INTENT, OPERATION_ID)
    expect(admission).toMatchObject({ decision: 'execute', ledger: 'app_only' })
    if (admission.decision === 'execute') {
      await expect(admission.settle(RESULT)).resolves.toBeUndefined()
      await expect(admission.fail('x')).resolves.toBeUndefined()
    }
  })

  it('refuses when the ledger fails any other way', async () => {
    const { ledger } = ledgerWith({
      admit: vi.fn(async () => {
        throw new Error('disk full: /secret/path')
      })
    })
    await expect(ledger.admit(INTENT, OPERATION_ID)).resolves.toEqual({
      decision: 'refuse',
      code: 'autopilot_launch_ledger_unavailable'
    })
  })

  it.each([
    ['a missing host', 'unavailable' as const, { kind: 'unavailable' }],
    ['a missing row', null, { kind: 'absent' }],
    ['a pending row', row({ status: 'pending' }), { kind: 'pending' }],
    ['an unknown row', row({ status: 'unknown' }), { kind: 'pending' }],
    [
      'a failed row',
      row({ status: 'failed', code: 'worktree_not_found' }),
      { kind: 'failed', code: 'worktree_not_found' }
    ],
    [
      'a succeeded row',
      row({ status: 'succeeded', sessionId: '', launch: RESULT }),
      { kind: 'succeeded', result: RESULT }
    ],
    [
      'an unreadable success',
      row({ status: 'succeeded', sessionId: '', launch: { odd: true } }),
      { kind: 'unreadable' }
    ]
  ])('reads %s without admitting anything', async (_label, stored, expected) => {
    const { ledger, deps } = ledgerWith({ readRow: vi.fn(() => stored) })
    expect(await ledger.read(OPERATION_ID)).toEqual(expected)
    expect(deps.readRow).toHaveBeenCalledWith(PRIMARY_LAUNCH_CALLER_KEY, OPERATION_ID)
    expect(deps.admit).not.toHaveBeenCalled()
  })
})

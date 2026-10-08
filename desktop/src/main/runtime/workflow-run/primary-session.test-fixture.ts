// FIXTURE_ONLY: handles, panes, incarnations and runs are synthetic; nothing here spawns or writes a PTY.
import { vi } from 'vitest'
import type {
  RuntimeTerminalAgentStatusState,
  RuntimeTerminalClose,
  RuntimeTerminalWait,
  RuntimeTerminalWaitCondition
} from '../../../shared/runtime-terminal-contracts'
import type { OrchestrationDb } from '../orchestration/db'
import {
  FIXTURE_HASH_A,
  FIXTURE_HASH_B,
  fixtureTime
} from '../orchestration/db/autopilot-runtime.test-fixture'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore, type WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import type {
  RuntimeAgentPromptWriteOptions,
  TerminalCreateOptions
} from '../runtime-terminal-contracts'
import type { PrimaryTerminalPort } from './primary-session-ports'

export const FIXTURE_PANE = 'tab_primary:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const FIXTURE_HANDLE = 'term_primary_a'
export const FIXTURE_INCARNATION = 'incarnation_a'
export const FIXTURE_EPOCH_MS = Date.parse('2026-10-05T00:00:00.000Z')

export type FakeTerminalState = {
  status: RuntimeTerminalAgentStatusState
  isRunningAgent: boolean
  /** Incarnation per handle; a handle missing here reads as null. */
  incarnations: Map<string, string>
  /** Handle per pane key. */
  panes: Map<string, string>
}

export function createFakeTerminal(state: Partial<FakeTerminalState> = {}) {
  const current: FakeTerminalState = {
    status: state.status === undefined ? 'idle' : state.status,
    isRunningAgent: state.isRunningAgent ?? true,
    incarnations: state.incarnations ?? new Map([[FIXTURE_HANDLE, FIXTURE_INCARNATION]]),
    panes: state.panes ?? new Map([[FIXTURE_PANE, FIXTURE_HANDLE]])
  }
  const terminal = {
    createTerminal: vi.fn(async (_selector: string, _opts: TerminalCreateOptions) => ({
      handle: FIXTURE_HANDLE,
      paneKey: FIXTURE_PANE,
      worktreeId: 'fixture-repo::/fixture/repo',
      title: null
    })),
    getTerminalAgentStatus: vi.fn(async (handle: string) => ({
      handle,
      isRunningAgent: current.isRunningAgent,
      status: current.isRunningAgent ? current.status : null
    })),
    getTerminalProcessIncarnation: vi.fn(
      (handle: string) => current.incarnations.get(handle) ?? null
    ),
    getTerminalHandleForPaneKey: vi.fn((paneKey: string) => current.panes.get(paneKey) ?? null),
    getOrchestrationDispatchAuthority: vi.fn((_handle: string) => ({
      launchTokenHash: FIXTURE_HASH_B
    })),
    waitForTerminal: vi.fn(
      (
        _handle: string,
        _options?: { condition?: RuntimeTerminalWaitCondition; signal?: AbortSignal }
      ) => new Promise<RuntimeTerminalWait>(() => undefined)
    ),
    sendTerminal: vi.fn(async (handle: string, _action: unknown, _options: unknown) => ({
      handle,
      accepted: true,
      bytesWritten: 1
    })),
    closeTerminal: vi.fn(async (handle: string): Promise<RuntimeTerminalClose> => ({
      handle,
      tabId: 'tab_primary',
      ptyKilled: true
    })),
    sendTerminalAgentPrompt: vi.fn(
      async (handle: string, prompt: string, options: RuntimeAgentPromptWriteOptions) => {
        await options.beforeWrite?.('pty_a')
        await options.beforeWrite?.('pty_a')
        const send = { handle, accepted: true, bytesWritten: prompt.length + 1 }
        options.onInputAccepted?.(send)
        return send
      }
    )
  } satisfies PrimaryTerminalPort
  return { terminal, state: current }
}

export function fakeClock(startMs = FIXTURE_EPOCH_MS) {
  let nowMs = startMs
  return {
    now: () => nowMs,
    sleep: vi.fn(async (ms: number) => {
      nowMs += ms
    }),
    advance(ms: number) {
      nowMs += ms
    }
  }
}

export type SeedRunOptions = {
  coordinatorAgent?: 'claude' | 'codex'
  runId?: string
  status?: 'launching' | 'active'
  owner?: 'none' | 'starting' | 'running' | 'unverifiable'
}

/** A run (launching or active) with an optional owner in the fixture pane. */
export function seedPrimaryRun(
  db: OrchestrationDb,
  options: SeedRunOptions = {}
): { run: WorkflowRunRecord; owner: PrimarySessionRecord | null } {
  const runId =
    options.runId ??
    db.createRun({
      objective: 'Fixture objective.',
      coordinatorHandle: null,
      coordinatorPaneKey: null
    }).id
  const runs = getWorkflowRunStore(db)
  let run = runs.create({
    runId,
    requestId: `request_${runId}`,
    workspaceId: 'fixture-repo::/fixture/repo',
    workspaceBinding: FIXTURE_HASH_A,
    requestedAccess: 'read_only',
    routingTableVersion: 1,
    routingTableSha256: FIXTURE_HASH_B,
    coordinatorAgent: options.coordinatorAgent ?? 'claude',
    coordinatorModel: options.coordinatorAgent === 'codex' ? 'gpt-6.1-sol' : 'claude-opus-5-5',
    coordinatorEffort: 'max',
    timestamp: fixtureTime()
  }).run
  const ownerKind = options.owner ?? 'running'
  let owner: PrimarySessionRecord | null = null
  if (ownerKind !== 'none') {
    const sessions = getPrimarySessionStore(db)
    owner = sessions.insertStarting({
      runId,
      launchOperationId: `operation_${runId}`,
      permissionMode: 'manual',
      requestedModel: 'claude-opus-5-5',
      requestedEffort: 'max',
      timestamp: fixtureTime()
    })
    if (ownerKind !== 'starting') {
      owner = sessions.markRunning(owner.ownerId, {
        terminalHandle: FIXTURE_HANDLE,
        paneKey: FIXTURE_PANE,
        processIncarnation: FIXTURE_INCARNATION,
        launchTokenSha256: FIXTURE_HASH_A,
        launchLedger: 'orca',
        receipt: { mode: 'terminal' },
        timestamp: fixtureTime(1)
      })
    }
    if (ownerKind === 'unverifiable') {
      owner = sessions.transition({
        ownerId: owner.ownerId,
        from: 'running',
        to: 'unverifiable',
        reason: 'reconciled_after_restart',
        timestamp: fixtureTime(2)
      })
    }
  }
  if ((options.status ?? 'active') === 'active') {
    run = runs.transition({
      runId,
      from: 'launching',
      to: 'active',
      expectedRevision: run.revision,
      reason: null,
      timestamp: fixtureTime(3)
    })
  }
  return { run, owner }
}

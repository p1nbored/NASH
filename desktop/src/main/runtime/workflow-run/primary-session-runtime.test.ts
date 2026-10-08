import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentLaunchIntent, AgentLaunchResult } from '../../../shared/agent-launch-intent'
import type { AgentLaunchSurfaceFactory } from '../../agent-launch/agent-launch-surface-factories'
import { getBundledRoutingTable } from '../../routing-table/routing-table-bundle'
import type { CoordinatorResolution } from '../../routing-table/route-resolver'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getRunMessageStore } from '../orchestration/db/run-message-store'
import { workbenchWorkspaceBinding } from '../orchestration/db/workbench-request-scope'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  composePrimarySessionRuntime,
  getPrimarySessionRuntime,
  requirePrimarySessionRuntime,
  setPrimarySessionRuntime,
  type PrimarySessionRuntime,
  type PrimarySessionRuntimePorts
} from './primary-session-runtime'
import { FIXTURE_HANDLE, createFakeTerminal, fakeClock } from './primary-session.test-fixture'
import { manualTimers } from './run-message.test-fixture'

const TABLE = getBundledRoutingTable()
const WORKSPACE = {
  workspaceId: 'fixture-repo::/fixture/repo',
  projectId: 'fixture-project',
  projectKind: 'project' as const,
  hostId: 'local' as const,
  path: resolve('/fixture/repo')
}

async function terminalExecutor(args: {
  intent: AgentLaunchIntent
  surfaces: AgentLaunchSurfaceFactory
}): Promise<AgentLaunchResult> {
  const worktreeId = args.intent.target.kind === 'existing' ? args.intent.target.worktree : ''
  const created = await args.surfaces.createTerminalAgent({
    worktreeId,
    agent: 'claude',
    ...(args.intent.prompt ? { startupPrompt: args.intent.prompt.text } : {}),
    agentArgs: args.intent.agentArgs ?? null
  })
  return {
    outcome: {
      kind: 'terminal',
      handle: created.handle,
      ...(created.paneKey ? { paneKey: created.paneKey } : {})
    },
    worktreeId,
    receipt: {
      mode: 'terminal',
      preferred: 'terminal',
      reason: 'user_default',
      detail: 'Started.'
    },
    prompt: { delivery: 'submit', outcome: 'handed-to-terminal' }
  }
}

describe('primary session runtime', () => {
  let db: OrchestrationDb
  let fake: ReturnType<typeof createFakeTerminal>
  let ports: PrimarySessionRuntimePorts
  let runtime: PrimarySessionRuntime
  let counter: number

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    fake = createFakeTerminal()
    counter = 0
    const coordinator: CoordinatorResolution = {
      ok: true,
      agent: 'claude',
      table: { version: 1, sha256: 'f'.repeat(64) },
      coordinator: {
        model: TABLE.coordinator.model,
        reasoningLevel: TABLE.coordinator.reasoning_level
      },
      availability: {
        subject: {
          target: 'claude_primary',
          primaryAgent: 'claude',
          model: TABLE.coordinator.model,
          reasoningLevel: TABLE.coordinator.reasoning_level,
          requirement: 'required',
          inheritsCoordinator: false
        },
        snapshot: {
          checkedAtMs: 1,
          freshness: 'dispatch',
          workspaceKind: null,
          checks: [],
          observedAtMs: { detection: 1, models: 1, rateLimits: 1 }
        },
        status: 'available',
        reasons: [],
        cli: {
          target: 'claude_primary',
          model: TABLE.coordinator.model,
          effort: TABLE.coordinator.reasoning_level,
          effortDelivery: 'claude_effort_flag',
          requestedLevel: TABLE.coordinator.reasoning_level,
          requirement: 'required',
          resolution: 'applied'
        }
      }
    }
    ports = {
      db,
      terminal: fake.terminal,
      ledger: {
        admit: vi.fn(async () => ({
          decision: 'execute' as const,
          ledger: 'orca' as const,
          record: async () => undefined,
          settle: async () => undefined,
          fail: async () => undefined
        })),
        read: vi.fn(() => ({ kind: 'absent' as const }))
      },
      executeLaunch: vi.fn(terminalExecutor),
      deliverAfterStart: vi.fn(async () => true),
      workspaces: { require: () => WORKSPACE },
      routing: {
        resolver: { resolveCoordinator: vi.fn(async () => coordinator) },
        activeTable: () => ({
          ok: true,
          table: TABLE,
          version: 1,
          sha256: 'f'.repeat(64),
          source: 'bundled'
        })
      },
      launchSettings: {
        userDataPath: resolve('/fixture/user-data'),
        platform: process.platform,
        cliCommand: 'orca',
        clientSettings: () => ({}),
        writeSettings: () => true
      },
      clock: fakeClock(),
      entropy: () => (counter++).toString(16).padStart(32, '0'),
      newRequestId: () => `send-${counter++}`,
      timers: manualTimers().timers
    }
    runtime = composePrimarySessionRuntime(ports)
  })
  afterEach(() => {
    runtime.dispose()
    setPrimarySessionRuntime(null)
    db.close()
  })

  const start = () =>
    runtime.startWorkflowRun({
      requestId: 'request_runtime01',
      workspaceId: WORKSPACE.workspaceId,
      workspaceBinding: workbenchWorkspaceBinding(WORKSPACE.workspaceId, WORKSPACE),
      objective: 'Summarize the repository.',
      requestedAccess: 'read_only'
    })

  it('refuses with a fixed code until the runtime is installed', () => {
    setPrimarySessionRuntime(null)
    expect(getPrimarySessionRuntime()).toBeNull()
    expect(() => requirePrimarySessionRuntime()).toThrow(OrchestrationError)
    try {
      requirePrimarySessionRuntime()
    } catch (error) {
      expect(error).toMatchObject({ code: 'autopilot_primary_session_not_configured' })
    }
    setPrimarySessionRuntime(runtime)
    expect(requirePrimarySessionRuntime()).toBe(runtime)
  })

  it('starts a run end to end through the A3 helpers and a background terminal', async () => {
    const result = await start()
    expect(result).toMatchObject({
      ok: true,
      duplicate: false,
      run: { status: 'active' },
      owner: { state: 'running' }
    })
    const [, options] = fake.terminal.createTerminal.mock.calls[0]
    expect(options.agentArgs).toContain('--permission-mode')
    expect(options.agentArgs).toContain('--settings')
    expect(options).not.toHaveProperty('focus')
    expect(options).not.toHaveProperty('activate')
    // Why per host: the fixture's settings path is checked against the host platform.
    if (process.platform === 'win32') {
      expect(options).not.toHaveProperty('startupPrompt')
      expect(ports.deliverAfterStart).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('Summarize the repository.') })
      )
    } else {
      expect(options.startupPrompt).toContain('Summarize the repository.')
      expect(ports.deliverAfterStart).not.toHaveBeenCalled()
    }
  })

  it('writes the status-line relay the launch settings resolve at launch', async () => {
    const writeSettings = vi.fn((_path: string, _value: unknown) => true)
    const statusLineRelay = vi.fn(() => ({
      nodeRuntimePath: resolve('/fixture/NASH/NASH.exe'),
      relayScriptPath: resolve('/fixture/NASH/relay.js'),
      shellPath: resolve('/fixture/Git/bin/bash.exe'),
      userSettingsPath: resolve('/fixture/home/.claude/settings.json')
    }))
    runtime.dispose()
    runtime = composePrimarySessionRuntime({
      ...ports,
      launchSettings: {
        ...ports.launchSettings,
        writeSettings,
        statusLineRelay,
        readSettingsText: () => null
      }
    })
    await start()
    expect(statusLineRelay).toHaveBeenCalledOnce()
    expect(writeSettings.mock.calls[0][1]).toMatchObject({
      statusLine: { type: 'command', command: expect.stringContaining('ELECTRON_RUN_AS_NODE=1') }
    })
  })

  it('reads status, delivers a follow-up message, reports the origin and stops the primary', async () => {
    const started = await start()
    const runId = started.run!.runId
    await expect(runtime.readPrimarySessionStatus(runId)).resolves.toMatchObject({
      owner: { state: 'running' },
      status: { kind: 'live', handle: FIXTURE_HANDLE, activity: 'idle' }
    })
    await expect(
      runtime.deliverRunMessage({
        runId,
        source: 'desktop',
        sourceRequestId: 'm1',
        text: 'Also list the tests.'
      })
    ).resolves.toMatchObject({ outcome: 'delivered' })
    expect(runtime.readRunOrigin(runId)).toMatchObject({ found: true, origin: 'unknown' })
    await expect(runtime.stopPrimarySession(runId, 'user_canceled')).resolves.toMatchObject({
      outcome: 'stopped'
    })
    await expect(runtime.readPrimarySessionStatus(runId)).resolves.toMatchObject({
      owner: { state: 'stopped' },
      status: { kind: 'ended', state: 'stopped' }
    })
  })

  it('reconciles owners and settles messages a crash left in flight', async () => {
    const started = await start()
    getRunMessageStore(db).recordReceived({
      runId: started.run!.runId,
      source: 'desktop',
      sourceRequestId: 'inflight',
      text: 'Lost.',
      textSha256: 'c'.repeat(64),
      timestamp: fixtureTime(1)
    })
    await expect(runtime.reconcile()).resolves.toMatchObject({ interruptedMessages: 1 })
    expect(ports.ledger.admit).toHaveBeenCalledOnce()
  })

  it('reports no status for a run without an owner', async () => {
    await expect(runtime.readPrimarySessionStatus('run_missing')).resolves.toBeNull()
  })
})

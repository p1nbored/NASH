import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AgentLaunchIntent, AgentLaunchResult } from '../../../shared/agent-launch-intent'
import type { AgentLaunchSurfaceFactory } from '../../agent-launch/agent-launch-surface-factories'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { FIXTURE_HASH_B } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import type { PrimaryLaunchAdmission } from './primary-session-ledger'
import {
  createPrimarySessionLauncher,
  type PrimarySessionLauncherDeps
} from './primary-session-launcher'
import type { PrimarySessionLaunchPlan } from './primary-session-launch-plan'
import { preparePrimarySessionLaunch } from './primary-session-launch-plan'
import { primarySessionOk, primarySessionRefused } from './primary-session-types'
import {
  FIXTURE_HANDLE,
  FIXTURE_INCARNATION,
  FIXTURE_PANE,
  createFakeTerminal,
  fakeClock,
  seedPrimaryRun
} from './primary-session.test-fixture'

const ENTROPY = 'abcdefabcdefabcdefabcdefabcdefab'

function planWith(delivery: 'launch_argument' | 'after_start_paste'): PrimarySessionLaunchPlan {
  return {
    agentArgs: "'--permission-mode' 'manual' '--settings' '/fixture/run-g1.json'",
    permissionMode: 'manual',
    sessionOptions: { model: 'claude-opus-5-5', effort: 'max' },
    launchPreferences: { model: 'claude-opus-5-5', effort: 'max' },
    shell: 'posix',
    probeCommand: 'claude ...',
    prompt: { text: 'You are the primary session. Plan the task.', delivery },
    settingsPath: '/fixture/run-g1.json',
    subagentNames: ['autopilot-software_engineering']
  }
}

/** Behaves like Orca's executor for a terminal launch: it builds the surface and reports the prompt. */
async function terminalExecutor(args: {
  intent: AgentLaunchIntent
  surfaces: AgentLaunchSurfaceFactory
  onSurfacePublished?: (surface: AgentLaunchResult) => void
}): Promise<AgentLaunchResult> {
  const { intent, surfaces } = args
  const worktreeId = intent.target.kind === 'existing' ? intent.target.worktree : ''
  const created = await surfaces.createTerminalAgent({
    worktreeId,
    agent: intent.agent,
    ...(intent.prompt ? { startupPrompt: intent.prompt.text } : {}),
    ...(intent.agentArgs !== undefined ? { agentArgs: intent.agentArgs } : {}),
    ...(intent.sessionOptions ? { options: intent.sessionOptions } : {}),
    ...(intent.launchSource ? { launchSource: intent.launchSource } : {})
  })
  const result: AgentLaunchResult = {
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
      detail: 'Started a terminal.'
    },
    ...(intent.prompt
      ? { prompt: { delivery: intent.prompt.delivery, outcome: 'handed-to-terminal' as const } }
      : {})
  }
  args.onSurfacePublished?.(result)
  return result
}

describe('primary session launcher', () => {
  let db: OrchestrationDb
  let fake: ReturnType<typeof createFakeTerminal>
  let admission: {
    record: Mock<(result: AgentLaunchResult) => Promise<void>>
    settle: Mock<(result: AgentLaunchResult) => Promise<void>>
    fail: Mock<(code: string) => Promise<void>>
  }
  let deps: PrimarySessionLauncherDeps

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    fake = createFakeTerminal()
    admission = {
      record: vi.fn(async () => undefined),
      settle: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined)
    }
    deps = {
      db,
      terminal: fake.terminal,
      ledger: {
        admit: vi.fn(async (): Promise<PrimaryLaunchAdmission> => ({
          decision: 'execute',
          ledger: 'orca',
          record: admission.record,
          settle: admission.settle,
          fail: admission.fail
        })),
        read: vi.fn(() => ({ kind: 'absent' as const }))
      },
      executeLaunch: vi.fn(terminalExecutor),
      prepare: vi.fn(() => primarySessionOk(planWith('launch_argument'))),
      deliverAfterStart: vi.fn(async () => true),
      stopUndelivered: vi.fn(async () => 'stopped' as const),
      exitWatches: { watch: vi.fn() },
      clock: fakeClock(),
      entropy: () => ENTROPY
    }
  })
  afterEach(() => db.close())

  function launchingRun() {
    return seedPrimaryRun(db, { status: 'launching', owner: 'none' }).run
  }

  function launch(runOverride = launchingRun()) {
    return createPrimarySessionLauncher(deps).launch({
      run: runOverride,
      objective: 'Summarize the repository.',
      workspacePath: '/fixture/repo',
      routeRows: []
    })
  }

  it('launches a visible terminal, records the owner, binds the Orca run and activates the run', async () => {
    const run = launchingRun()
    const outcome = await launch(run)
    expect(outcome).toMatchObject({
      ok: true,
      run: { status: 'active' },
      owner: {
        state: 'running',
        terminalHandle: FIXTURE_HANDLE,
        paneKey: FIXTURE_PANE,
        processIncarnation: FIXTURE_INCARNATION,
        launchTokenSha256: FIXTURE_HASH_B,
        launchLedger: 'orca',
        permissionMode: 'manual',
        requestedModel: 'claude-opus-5-5',
        requestedEffort: 'max'
      }
    })
    const intent = vi.mocked(deps.executeLaunch).mock.calls[0][0].intent
    expect(intent).toEqual({
      agent: 'claude',
      target: { kind: 'existing', worktree: run.workspaceId, workspacePath: '/fixture/repo' },
      prompt: { text: 'You are the primary session. Plan the task.', delivery: 'submit' },
      sessionOptions: { model: 'claude-opus-5-5', effort: 'max' },
      agentArgs: planWith('launch_argument').agentArgs,
      launchSource: 'workbench'
    })
    expect(deps.ledger.admit).toHaveBeenCalledWith(
      intent,
      expect.stringMatching(/^\d{13}-[0-9a-f]{32}$/)
    )
    expect(admission.settle).toHaveBeenCalledOnce()
    expect(db.getRun(run.runId)).toMatchObject({
      coordinator_handle: FIXTURE_HANDLE,
      coordinator_pane_key: FIXTURE_PANE
    })
    expect(deps.exitWatches?.watch).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'running' })
    )
    expect(deps.deliverAfterStart).not.toHaveBeenCalled()
    const receipt = outcome.ok ? outcome.owner.receipt : null
    expect(JSON.stringify(receipt)).not.toContain('Plan the task')
  })

  it("hands the session's workspace to the launch plan so its status line can be read", async () => {
    await launch()
    expect(deps.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: '/fixture/repo' })
    )
  })

  it('launches exactly the pinned Codex primary and delivers its context through Codex readiness', async () => {
    const run = seedPrimaryRun(db, {
      status: 'launching',
      owner: 'none',
      coordinatorAgent: 'codex'
    }).run
    vi.mocked(deps.prepare).mockImplementation((request) =>
      preparePrimarySessionLaunch({
        ...request,
        userDataPath: '/fixture/data',
        platform: 'win32',
        cliCommand: 'orca',
        clientSettings: {}
      })
    )
    const outcome = await launch(run)
    expect(outcome).toMatchObject({
      ok: true,
      run: { coordinatorAgent: 'codex', status: 'active' }
    })
    expect(deps.executeLaunch).toHaveBeenCalledOnce()
    expect(fake.terminal.createTerminal).toHaveBeenCalledOnce()
    expect(vi.mocked(deps.executeLaunch).mock.calls[0][0].intent).toMatchObject({
      agent: 'codex',
      sessionOptions: {
        model: run.coordinatorModel,
        effort: run.coordinatorEffort,
        taskAccess: 'read_only'
      }
    })
    expect(fake.terminal.createTerminal.mock.calls[0][1]).toMatchObject({
      startupAgent: 'codex',
      launchPreferences: {
        model: run.coordinatorModel,
        effort: run.coordinatorEffort,
        taskAccess: 'read_only',
        routeValidated: true
      }
    })
    expect(deps.deliverAfterStart).toHaveBeenCalledWith({
      handle: FIXTURE_HANDLE,
      agent: 'codex',
      text: expect.stringContaining('primary Codex session')
    })
  })

  it('records the published terminal even when prompt delivery later fails', async () => {
    vi.mocked(deps.executeLaunch).mockImplementationOnce(async (args) => {
      await terminalExecutor(args)
      throw new Error('prompt delivery interrupted')
    })
    const outcome = await launch()
    expect(outcome).toMatchObject({ ok: false, run: { status: 'unverifiable' } })
    expect(admission.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: { kind: 'terminal', handle: FIXTURE_HANDLE, paneKey: FIXTURE_PANE }
      })
    )
    expect(admission.settle).not.toHaveBeenCalled()
    expect(admission.fail).not.toHaveBeenCalled()
  })

  it('runs one launch per run: a concurrent second call joins the first', async () => {
    const run = launchingRun()
    const launcher = createPrimarySessionLauncher(deps)
    const request = { run, objective: 'Go.', workspacePath: '/fixture/repo', routeRows: [] }
    const [first, second] = await Promise.all([launcher.launch(request), launcher.launch(request)])
    expect(second).toEqual(first)
    expect(deps.executeLaunch).toHaveBeenCalledOnce()
  })

  it('refuses a structured receipt and never relaunches', async () => {
    vi.mocked(deps.executeLaunch).mockResolvedValueOnce({
      outcome: { kind: 'structured', sessionId: 'claude-session', handle: 'tab' },
      worktreeId: 'w',
      receipt: {
        mode: 'structured',
        preferred: 'structured',
        reason: 'user_default',
        detail: 'Chat.'
      }
    })
    const run = launchingRun()
    const outcome = await launch(run)
    expect(outcome).toMatchObject({
      ok: false,
      blocker: {
        reason: 'launch_blocked',
        detail: 'launch_refused',
        code: 'autopilot_launch_receipt_refused'
      },
      run: { status: 'unverifiable' },
      owner: { state: 'unverifiable' }
    })
    expect(admission.fail).toHaveBeenCalledWith('autopilot_launch_receipt_refused')
    await expect(launch(getWorkflowRunStore(db).get(run.runId)!)).resolves.toMatchObject({
      ok: false,
      blocker: { code: 'autopilot_launch_run_not_launching' }
    })
    expect(deps.executeLaunch).toHaveBeenCalledOnce()
  })

  it('refuses a terminal whose argv prompt was not handed over, and closes it', async () => {
    vi.mocked(deps.executeLaunch).mockImplementationOnce(async (args) => ({
      ...(await terminalExecutor(args)),
      prompt: { delivery: 'submit', outcome: 'not-delivered' }
    }))
    await expect(launch()).resolves.toMatchObject({
      ok: false,
      blocker: { detail: 'launch_refused', code: 'autopilot_launch_receipt_refused' },
      run: { status: 'unverifiable' }
    })
    expect(fake.terminal.closeTerminal).toHaveBeenCalledWith(FIXTURE_HANDLE)
    expect(admission.fail).toHaveBeenCalledWith('autopilot_launch_receipt_refused')
  })

  it('marks the run unverifiable when the launch throws after the spawn was requested', async () => {
    fake.terminal.createTerminal.mockImplementationOnce(async (_selector, options) => {
      options.onPtySpawnDispatched?.()
      throw new Error('pty_spawn_reply_lost')
    })
    const outcome = await launch()
    expect(outcome).toMatchObject({
      ok: false,
      blocker: { detail: 'launch_unverifiable', code: 'autopilot_launch_outcome_unknown' },
      run: { status: 'unverifiable', endReason: 'launch_outcome_unknown' },
      owner: { state: 'unverifiable', endReason: 'launch_outcome_unknown' }
    })
    expect(admission.fail).not.toHaveBeenCalled()
    expect(admission.settle).not.toHaveBeenCalled()
  })

  it('fails the run with no effects when the terminal failed before its spawn left', async () => {
    fake.terminal.createTerminal.mockRejectedValueOnce(new Error('worktree_not_found'))
    const outcome = await launch()
    expect(outcome).toMatchObject({
      ok: false,
      blocker: { detail: 'launch_refused', code: 'worktree_not_found' },
      run: { status: 'failed', endReason: 'launch_refused' },
      owner: { state: 'stopped', endReason: 'launch_failed_no_effects' }
    })
    expect(admission.fail).toHaveBeenCalledWith('worktree_not_found')
  })

  it('refuses before admission when the plan is refused', async () => {
    vi.mocked(deps.prepare).mockReturnValueOnce(
      primarySessionRefused('autopilot_session_command_override', 'Override set.')
    )
    const outcome = await launch()
    expect(outcome).toMatchObject({
      ok: false,
      blocker: { detail: 'launch_refused', code: 'autopilot_session_command_override' },
      run: { status: 'failed' },
      owner: { state: 'stopped' }
    })
    expect(deps.ledger.admit).not.toHaveBeenCalled()
    expect(deps.executeLaunch).not.toHaveBeenCalled()
  })

  it("refuses with Orca's code when the ledger refuses", async () => {
    vi.mocked(deps.ledger.admit).mockResolvedValueOnce({
      decision: 'refuse',
      code: 'autopilot_launch_ledger_unavailable'
    })
    await expect(launch()).resolves.toMatchObject({
      ok: false,
      blocker: { code: 'autopilot_launch_ledger_unavailable' },
      run: { status: 'failed' }
    })
    expect(deps.executeLaunch).not.toHaveBeenCalled()
  })

  describe('a step that throws after the owner was recorded', () => {
    const thrown = () =>
      Object.assign(new Error('Fixture: write failed at C:\\private'), {
        code: 'autopilot_settings_write_failed'
      })
    const noEffects = {
      ok: false,
      blocker: { detail: 'launch_refused', code: 'autopilot_settings_write_failed' },
      run: { status: 'failed', endReason: 'launch_refused' },
      owner: { state: 'stopped', endReason: 'launch_failed_no_effects' }
    }

    it('closes the owner as no-effects when the launch preparation throws', async () => {
      vi.mocked(deps.prepare).mockImplementationOnce(() => {
        throw thrown()
      })
      const outcome = await launch()
      expect(outcome).toMatchObject(noEffects)
      expect(JSON.stringify(outcome)).not.toContain('private')
      expect(deps.ledger.admit).not.toHaveBeenCalled()
      expect(deps.executeLaunch).not.toHaveBeenCalled()
    })

    it('closes the owner as no-effects when the ledger admission throws', async () => {
      vi.mocked(deps.ledger.admit).mockRejectedValueOnce(thrown())
      await expect(launch()).resolves.toMatchObject(noEffects)
      expect(deps.executeLaunch).not.toHaveBeenCalled()
    })

    it('closes the owner as no-effects with the spawn cause when the ledger cannot record it', async () => {
      fake.terminal.createTerminal.mockRejectedValueOnce(new Error('worktree_not_found'))
      admission.fail.mockRejectedValueOnce(thrown())
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      await expect(launch()).resolves.toMatchObject({
        ...noEffects,
        blocker: { detail: 'launch_refused', code: 'worktree_not_found' }
      })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('autopilot_settings_write_failed'))
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private')
      warn.mockRestore()
    })

    it('marks the owner unverifiable when a throw follows a spawn that may have left', async () => {
      fake.terminal.createTerminal.mockImplementationOnce(async (_selector, options) => {
        options.onPtySpawnDispatched?.()
        throw new Error('pty_spawn_reply_lost')
      })
      const runTransition = vi
        .spyOn(getWorkflowRunStore(db), 'transition')
        .mockImplementationOnce(() => {
          throw thrown()
        })
      const outcome = await launch()
      expect(runTransition).toHaveBeenCalled()
      expect(outcome).toMatchObject({
        ok: false,
        blocker: { detail: 'launch_unverifiable', code: 'autopilot_launch_outcome_unknown' },
        owner: { state: 'unverifiable' },
        run: { status: 'unverifiable' }
      })
    })
  })

  it('records an app-only ledger when Orca has none', async () => {
    vi.mocked(deps.ledger.admit).mockResolvedValueOnce({
      decision: 'execute',
      ledger: 'app_only',
      record: async () => undefined,
      settle: async () => undefined,
      fail: async () => undefined
    })
    await expect(launch()).resolves.toMatchObject({ ok: true, owner: { launchLedger: 'app_only' } })
  })

  it('marks the run unverifiable when the new pane has no process identity', async () => {
    fake.state.incarnations.clear()
    await expect(launch()).resolves.toMatchObject({
      ok: false,
      blocker: { detail: 'launch_unverifiable', code: 'autopilot_launch_identity_unavailable' },
      run: { status: 'unverifiable' },
      owner: { state: 'unverifiable' }
    })
    expect(admission.settle).toHaveBeenCalledOnce()
  })

  it('pastes a long prompt after start and never on argv', async () => {
    vi.mocked(deps.prepare).mockReturnValueOnce(primarySessionOk(planWith('after_start_paste')))
    await expect(launch()).resolves.toMatchObject({ ok: true })
    expect(vi.mocked(deps.executeLaunch).mock.calls[0][0].intent.prompt).toBeUndefined()
    expect(deps.deliverAfterStart).toHaveBeenCalledWith({
      handle: FIXTURE_HANDLE,
      agent: 'claude',
      text: 'You are the primary session. Plan the task.'
    })
  })

  it('stops the session and fails the run when the pasted prompt did not land', async () => {
    vi.mocked(deps.prepare).mockReturnValueOnce(primarySessionOk(planWith('after_start_paste')))
    vi.mocked(deps.deliverAfterStart).mockResolvedValueOnce(false)
    await expect(launch()).resolves.toMatchObject({
      ok: false,
      blocker: { detail: 'launch_refused', code: 'autopilot_launch_prompt_undelivered' },
      run: { status: 'failed', endReason: 'launch_prompt_undelivered' }
    })
    expect(deps.stopUndelivered).toHaveBeenCalledOnce()
  })

  it('refuses a run that already has a live primary without touching it', async () => {
    const seeded = seedPrimaryRun(db, { status: 'launching', owner: 'running' })
    await expect(launch(seeded.run)).resolves.toMatchObject({
      ok: false,
      blocker: { code: 'autopilot_owner_exists' },
      run: { status: 'launching' }
    })
    expect(getPrimarySessionStore(db).findLiveByRun(seeded.run.runId)?.ownerId).toBe(
      seeded.owner?.ownerId
    )
  })
})

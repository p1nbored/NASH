import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureActiveRoutingTable } from '../../routing-table/routing-table-activation'
import { createTestRoutingTableEnvironment } from '../../routing-table/routing-table-test-context.test-fixture'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { readSchemaEntries } from '../orchestration/db/autopilot-runtime.test-fixture'
import { registerRoutingTableContext } from '../workbench-run/routing-table-context-registry'
import { resolveAutopilotPrimaryCaller } from '../rpc/methods/orchestration/autopilot/autopilot-primary-caller'
import {
  createTaskApiHarness,
  primaryAuthority,
  PRIMARY_HANDLE,
  PRIMARY_PANE,
  type TaskApiHarness
} from '../rpc/methods/orchestration/autopilot/autopilot-task-api.test-fixture'
import { adoptNativeCoordinator, nativeCoordinatorAuthority } from './native-coordinator-adoption'
import {
  assertAppRunPrimaryMayCreateRun,
  assertAppRunUseAllowed,
  assertAppRunTaskUpdateAllowed,
  assertAppRunUsesTaskStart,
  retireUnboundCoordinatorOwners
} from './app-run-policy'
import { appRunReadersFor } from './app-run-readers'
import { resolveAppRunPrimary } from './app-run-primary'
import { createPrimarySessionStopper } from './primary-session-stop'
import { reconcilePrimarySessions } from './primary-session-reconcile'
import { createFakeTerminal, fakeClock } from './primary-session.test-fixture'

// FIXTURE_ONLY: in-memory stores and host evidence; no agent process is started.
describe('native coordinator adoption', () => {
  let h: TaskApiHarness
  let unregister: () => void
  beforeEach(() => {
    h = createTaskApiHarness({ appRun: false })
    const table = createTestRoutingTableEnvironment()
    ensureActiveRoutingTable(table.ctx)
    unregister = registerRoutingTableContext(h.runtime, table.ctx)
    const authority = primaryAuthority(h.runId)
    vi.spyOn(h.runtime, 'getOrchestrationDispatchAuthority').mockReturnValue({
      ...authority,
      runtimeId: 'runtime_fixture',
      ptyId: 'pty_fixture',
      worktreeId: 'fixture-repo::/fixture/repo'
    })
    vi.spyOn(h.runtime, 'getTerminalWorktreeIdForHandle').mockReturnValue(
      'fixture-repo::/fixture/repo'
    )
    vi.spyOn(h.runtime, 'requireWorkbenchWorkspace').mockReturnValue({
      workspaceId: 'fixture-repo::/fixture/repo',
      projectId: 'project_fixture',
      projectKind: 'project',
      hostId: 'local',
      path: '/fixture/repo'
    })
    vi.spyOn(h.runtime, 'readNativeCoordinatorLaunch').mockReturnValue({
      agent: 'claude',
      agentArgs: '--model claude-opus-5-5 --effort max'
    })
  })
  afterEach(() => {
    unregister()
    h.close()
  })

  const key = () => ({ terminalHandle: PRIMARY_HANDLE, paneKey: PRIMARY_PANE, orcaSessionId: null })
  const adopt = () => adoptNativeCoordinator(h.runtime, primaryAuthority(h.runId))

  it('adopts the existing CLI without replacing its run, tasks or binding', () => {
    const task = h.db.createTask({ runId: h.runId, spec: 'Existing native task' })
    const before = h.db.getRun(h.runId)
    const adopted = adopt()
    expect(adopted.run).toMatchObject({
      runId: h.runId,
      status: 'active',
      requestedAccess: 'read_only',
      coordinatorAgent: 'claude',
      coordinatorModel: 'claude-opus-5-5',
      coordinatorEffort: 'max'
    })
    expect(adopted.owner).toMatchObject({
      terminalHandle: PRIMARY_HANDLE,
      paneKey: PRIMARY_PANE,
      processIncarnation: primaryAuthority(h.runId).processIncarnation,
      receipt: { nativeCoordinator: true }
    })
    expect(h.db.getRun(h.runId)).toEqual(before)
    expect(h.db.getTask(task.id)).toEqual(task)
    expect(adopt()).toEqual(adopted)
  })

  it('lets the attested native coordinator use the existing classified task API', () => {
    const caller = resolveAutopilotPrimaryCaller(h.runtime, h.context, { requireActiveRun: true })
    expect(caller.runId).toBe(h.runId)
    expect(caller.runGeneration).toBe(h.db.getRun(h.runId)?.consumer_generation)
    expect(getWorkflowRunStore(h.db).get(h.runId)?.status).toBe('active')
  })

  it('preserves old native task lifecycle while requiring routing for new tasks', () => {
    const old = h.db.createTask({ runId: h.runId, spec: 'Existing worker task' })
    adopt()
    const next = h.db.createTask({ runId: h.runId, spec: 'New task needs classification' })
    expect(() =>
      assertAppRunTaskUpdateAllowed(h.db, { runId: h.runId, taskId: old.id, status: 'completed' })
    ).not.toThrow()
    expect(() =>
      assertAppRunUsesTaskStart(h.db, { runId: h.runId, taskId: old.id, command: 'worker-start' })
    ).not.toThrow()
    expect(() =>
      assertAppRunTaskUpdateAllowed(h.db, { runId: h.runId, taskId: next.id, status: 'completed' })
    ).toThrow()
    expect(() =>
      assertAppRunUsesTaskStart(h.db, { runId: h.runId, taskId: next.id, command: 'worker-start' })
    ).toThrow()
  })

  it('records Codex launch selection without adopting the routing table coordinator model', () => {
    vi.mocked(h.runtime.readNativeCoordinatorLaunch).mockReturnValue({
      agent: 'codex',
      agentArgs: '-m gpt-6.1-sol -c model_reasoning_effort=high'
    })
    expect(adopt().run).toMatchObject({
      coordinatorAgent: 'codex',
      coordinatorModel: 'gpt-6.1-sol',
      coordinatorEffort: 'high'
    })
  })

  it('records unknown launch selection honestly without changing the running CLI', () => {
    vi.mocked(h.runtime.readNativeCoordinatorLaunch).mockReturnValue({
      agent: 'codex',
      agentArgs: null
    })
    expect(adopt().run).toMatchObject({
      coordinatorModel: 'session-default',
      coordinatorEffort: 'none'
    })
  })

  it('requires a specifically selected live coordinator and rejects stale caller evidence', () => {
    expect(() => nativeCoordinatorAuthority(h.runtime, 'run_missing')).toThrow()
    expect(() =>
      adoptNativeCoordinator(h.runtime, {
        ...primaryAuthority(h.runId),
        processIncarnation: 'stale'
      })
    ).toThrow()
    expect(() =>
      adoptNativeCoordinator(h.runtime, primaryAuthority(h.runId), { runId: 'run_other' })
    ).toThrow()
    expect(
      h.db.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'workflow_runs'").get()
    ).toBeUndefined()
  })

  it('refuses unsupported CLI identity before creating metadata', () => {
    vi.mocked(h.runtime.readNativeCoordinatorLaunch).mockReturnValue({
      agent: 'antigravity',
      agentArgs: null
    })
    const before = readSchemaEntries(h.db.db)
    expect(adopt).toThrow(expect.objectContaining({ code: 'autopilot_native_coordinator_refused' }))
    expect(readSchemaEntries(h.db.db)).toEqual(before)
  })

  it('keeps an existing access limit and original request provenance', () => {
    const original = adopt()
    expect(() =>
      adoptNativeCoordinator(h.runtime, primaryAuthority(h.runId), {
        requestId: 'dot_fixture',
        requestedAccess: 'workspace_write'
      })
    ).toThrow()
    const attached = adoptNativeCoordinator(h.runtime, primaryAuthority(h.runId), {
      requestId: 'dot_fixture',
      requestedAccess: 'read_only'
    })
    expect(attached).toEqual(original)
  })

  it('accepts a host-authorized initial access limit', () => {
    expect(
      adoptNativeCoordinator(h.runtime, primaryAuthority(h.runId), {
        requestId: 'dot_fixture',
        requestedAccess: 'workspace_write'
      }).run
    ).toMatchObject({ requestId: 'dot_fixture', requestedAccess: 'workspace_write' })
  })

  it('allows quiescent native run switching and retires only the old owner lease', () => {
    const old = adopt()
    expect(() => assertAppRunPrimaryMayCreateRun(h.db, key())).not.toThrow()
    const next = h.db.createRun({
      objective: 'Another task',
      coordinatorHandle: PRIMARY_HANDLE,
      coordinatorPaneKey: PRIMARY_PANE
    })
    expect(resolveAppRunPrimary(h.db, appRunReadersFor(h.db), primaryAuthority(h.runId)).ok).toBe(
      false
    )
    retireUnboundCoordinatorOwners(h.db, [h.runId])
    expect(getPrimarySessionStore(h.db).get(old.owner.ownerId)).toMatchObject({
      state: 'exited',
      endReason: 'coordinator_rebound'
    })
    expect(h.db.getRun(next.id)?.coordinator_handle).toBe(PRIMARY_HANDLE)
    expect(h.db.getRun(h.runId)).toBeDefined()
    expect(h.runtime.readNativeCoordinatorLaunch(PRIMARY_HANDLE)?.agent).toBe('claude')
  })

  it('refuses switching away from pending tasks without changing coordinator ownership', () => {
    const original = adopt()
    h.db.createTask({ runId: h.runId, spec: 'Pending task' })
    expect(() => assertAppRunPrimaryMayCreateRun(h.db, key())).toThrow()
    expect(() => assertAppRunUseAllowed(h.db, key(), 'run_other')).toThrow()
    expect(getPrimarySessionStore(h.db).findLiveByRun(h.runId)).toEqual(original.owner)
    expect(h.db.getCurrentRunForCoordinator(key())?.id).toBe(h.runId)
  })

  it.each(['user_canceled', 'run_completed'])(
    'does not interrupt or close an adopted CLI for %s',
    async (reason) => {
      const { owner } = adopt()
      const fake = createFakeTerminal()
      const stop = createPrimarySessionStopper({
        db: h.db,
        terminal: fake.terminal,
        clock: fakeClock()
      })
      await expect(stop.stop(h.runId, reason)).resolves.toMatchObject({
        outcome: 'refused',
        code: 'autopilot_native_coordinator_user_owned'
      })
      expect(getPrimarySessionStore(h.db).get(owner.ownerId)).toEqual(owner)
      expect(fake.terminal.sendTerminal).not.toHaveBeenCalled()
      expect(fake.terminal.closeTerminal).not.toHaveBeenCalled()
    }
  )

  it('reconciles an adopted live session without launching, changing or stopping it', async () => {
    const original = adopt()
    const fake = createFakeTerminal({
      incarnations: new Map([[PRIMARY_HANDLE, primaryAuthority(h.runId).processIncarnation]]),
      panes: new Map([[PRIMARY_PANE, PRIMARY_HANDLE]])
    })
    const read = vi.fn(() => ({ kind: 'absent' as const }))
    const admit = vi.fn()
    const watch = vi.fn()
    await reconcilePrimarySessions({
      db: h.db,
      terminal: fake.terminal,
      ledger: { read, admit },
      clock: fakeClock(),
      exitWatches: { watch }
    })
    expect(getPrimarySessionStore(h.db).get(original.owner.ownerId)).toEqual(original.owner)
    expect(watch).toHaveBeenCalledWith(original.owner)
    expect(read).not.toHaveBeenCalled()
    expect(admit).not.toHaveBeenCalled()
    expect(fake.terminal.createTerminal).not.toHaveBeenCalled()
    expect(fake.terminal.sendTerminal).not.toHaveBeenCalled()
    expect(fake.terminal.closeTerminal).not.toHaveBeenCalled()
  })

  it('reconciles a native rebind by retiring metadata without touching either CLI', async () => {
    const original = adopt()
    h.db.bindRun({
      runId: h.runId,
      coordinatorHandle: 'terminal_other',
      coordinatorPaneKey: 'pane_other:1'
    })
    const fake = createFakeTerminal()
    const watch = vi.fn()
    await reconcilePrimarySessions({
      db: h.db,
      terminal: fake.terminal,
      ledger: { read: vi.fn(() => ({ kind: 'absent' as const })), admit: vi.fn() },
      clock: fakeClock(),
      exitWatches: { watch }
    })
    expect(getPrimarySessionStore(h.db).get(original.owner.ownerId)).toMatchObject({
      state: 'exited',
      endReason: 'coordinator_rebound'
    })
    expect(h.db.getRun(h.runId)?.coordinator_handle).toBe('terminal_other')
    expect(watch).not.toHaveBeenCalled()
    expect(fake.terminal.sendTerminal).not.toHaveBeenCalled()
    expect(fake.terminal.closeTerminal).not.toHaveBeenCalled()
  })
})

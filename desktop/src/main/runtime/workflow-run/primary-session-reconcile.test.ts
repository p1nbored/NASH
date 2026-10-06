import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AgentLaunchResult } from '../../../shared/agent-launch-intent'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import type { PrimaryLaunchLedgerPort, PrimaryLaunchLedgerRow } from './primary-session-ledger'
import type { PrimarySessionRecord } from '../orchestration/db/primary-session-store'
import { reconcilePrimarySessions } from './primary-session-reconcile'
import {
  FIXTURE_HANDLE,
  FIXTURE_INCARNATION,
  FIXTURE_PANE,
  createFakeTerminal,
  fakeClock,
  seedPrimaryRun
} from './primary-session.test-fixture'

const LAUNCHED: AgentLaunchResult = {
  outcome: { kind: 'terminal', handle: 'term_before_restart', paneKey: FIXTURE_PANE },
  worktreeId: 'fixture-repo::/fixture/repo',
  receipt: { mode: 'terminal', preferred: 'terminal', reason: 'user_default', detail: 'Started.' },
  prompt: { delivery: 'submit', outcome: 'handed-to-terminal' }
}

describe('primary session reconcile after a restart', () => {
  let db: OrchestrationDb
  let fake: ReturnType<typeof createFakeTerminal>
  let ledgerRow: PrimaryLaunchLedgerRow
  let read: Mock<(operationId: string) => PrimaryLaunchLedgerRow>
  let admit: Mock<PrimaryLaunchLedgerPort['admit']>
  let watch: Mock<(owner: PrimarySessionRecord) => void>

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    fake = createFakeTerminal()
    ledgerRow = { kind: 'absent' }
    read = vi.fn(() => ledgerRow)
    admit = vi.fn()
    watch = vi.fn()
  })
  afterEach(() => {
    expect(admit).not.toHaveBeenCalled()
    db.close()
  })

  const reconcile = () =>
    reconcilePrimarySessions({
      db,
      terminal: fake.terminal,
      ledger: { read, admit },
      clock: fakeClock(),
      exitWatches: { watch }
    })

  const ownerOf = (runId: string) => getPrimarySessionStore(db).latestForRun(runId)
  const runOf = (runId: string) => getWorkflowRunStore(db).get(runId)

  it('adopts a launch the ledger recorded as succeeded, as unverifiable, without launching', async () => {
    const { run } = seedPrimaryRun(db, { status: 'launching', owner: 'starting' })
    ledgerRow = { kind: 'succeeded', result: LAUNCHED }
    const report = await reconcile()
    expect(ownerOf(run.runId)).toMatchObject({
      state: 'unverifiable',
      endReason: 'reconciled_after_restart',
      paneKey: FIXTURE_PANE,
      terminalHandle: FIXTURE_HANDLE,
      processIncarnation: FIXTURE_INCARNATION,
      launchLedger: 'orca'
    })
    expect(runOf(run.runId)).toMatchObject({
      status: 'unverifiable',
      endReason: 'launch_outcome_unknown'
    })
    expect(report.adopted).toBe(1)
    expect(read).toHaveBeenCalledWith(ownerOf(run.runId)?.launchOperationId)
  })

  it.each([
    [{ kind: 'absent' } as const],
    [{ kind: 'pending' } as const],
    [{ kind: 'unavailable' } as const]
  ])('marks a starting owner unknown when the ledger shows %o', async (row) => {
    const { run } = seedPrimaryRun(db, { status: 'launching', owner: 'starting' })
    ledgerRow = row
    await reconcile()
    expect(ownerOf(run.runId)).toMatchObject({
      state: 'unverifiable',
      endReason: 'launch_outcome_unknown'
    })
    expect(runOf(run.runId)?.status).toBe('unverifiable')
  })

  it('marks a succeeded launch whose pane cannot be found as unknown', async () => {
    const { run } = seedPrimaryRun(db, { status: 'launching', owner: 'starting' })
    ledgerRow = { kind: 'succeeded', result: LAUNCHED }
    fake.state.panes.clear()
    await reconcile()
    expect(ownerOf(run.runId)).toMatchObject({ state: 'unverifiable', paneKey: null })
  })

  it('closes a launch the ledger recorded as failed with no effects', async () => {
    const { run } = seedPrimaryRun(db, { status: 'launching', owner: 'starting' })
    ledgerRow = { kind: 'failed', code: 'worktree_not_found' }
    await reconcile()
    expect(ownerOf(run.runId)).toMatchObject({
      state: 'stopped',
      endReason: 'launch_failed_no_effects'
    })
    expect(runOf(run.runId)).toMatchObject({ status: 'failed', endReason: 'launch_refused' })
  })

  it('fails a launching run that never got an owner', async () => {
    const { run } = seedPrimaryRun(db, { status: 'launching', owner: 'none' })
    await reconcile()
    expect(runOf(run.runId)).toMatchObject({ status: 'failed', endReason: 'launch_refused' })
  })

  it('keeps a running owner whose pane and incarnation still match, and watches it', async () => {
    const { run, owner } = seedPrimaryRun(db)
    await reconcile()
    expect(ownerOf(run.runId)?.state).toBe('running')
    expect(runOf(run.runId)?.status).toBe('active')
    expect(watch).toHaveBeenCalledWith(expect.objectContaining({ ownerId: owner?.ownerId }))
  })

  it('marks a running owner it cannot verify as unverifiable, never exited', async () => {
    const { run } = seedPrimaryRun(db)
    fake.state.incarnations.clear()
    await reconcile()
    expect(ownerOf(run.runId)).toMatchObject({
      state: 'unverifiable',
      endReason: 'reconciled_after_restart'
    })
    expect(runOf(run.runId)?.status).toBe('active')
  })

  it('marks an owner caught mid-stop as unverifiable', async () => {
    const { run, owner } = seedPrimaryRun(db)
    getPrimarySessionStore(db).transition({
      ownerId: owner!.ownerId,
      from: 'running',
      to: 'stopping',
      reason: null,
      timestamp: fixtureTime(9)
    })
    await reconcile()
    expect(ownerOf(run.runId)).toMatchObject({
      state: 'unverifiable',
      endReason: 'stop_interrupted'
    })
  })

  it('moves an unverifiable owner back to running when its pane verifies', async () => {
    const { run } = seedPrimaryRun(db, { owner: 'unverifiable' })
    const report = await reconcile()
    expect(ownerOf(run.runId)?.state).toBe('running')
    expect(report.verified).toBe(1)
  })

  it('releases the Orca binding an ended primary left behind', async () => {
    const { run, owner } = seedPrimaryRun(db)
    db.bindRun({
      runId: run.runId,
      coordinatorHandle: FIXTURE_HANDLE,
      coordinatorPaneKey: FIXTURE_PANE
    })
    getPrimarySessionStore(db).transition({
      ownerId: owner!.ownerId,
      from: 'running',
      to: 'exited',
      reason: 'primary_exited',
      timestamp: fixtureTime(9)
    })
    const report = await reconcile()
    expect(db.getRun(run.runId)?.coordinator_pane_key).toBeNull()
    expect(report.releasedBindings).toBe(1)
  })

  it('fails an open run whose primary exited before the exit could be recorded on the run', async () => {
    const { run, owner } = seedPrimaryRun(db)
    getPrimarySessionStore(db).transition({
      ownerId: owner!.ownerId,
      from: 'running',
      to: 'exited',
      reason: 'primary_exited',
      timestamp: fixtureTime(9)
    })
    const report = await reconcile()
    expect(runOf(run.runId)).toMatchObject({ status: 'failed', endReason: 'primary_exited' })
    expect(report.endedRuns).toBe(1)
  })

  it('leaves an open run alone when its primary ended for another reason than an exit', async () => {
    const { run, owner } = seedPrimaryRun(db)
    const sessions = getPrimarySessionStore(db)
    const ownerId = owner!.ownerId
    sessions.transition({
      ownerId,
      from: 'running',
      to: 'stopping',
      reason: null,
      timestamp: fixtureTime(8)
    })
    sessions.transition({
      ownerId,
      from: 'stopping',
      to: 'stopped',
      reason: 'launch_failed_no_effects',
      timestamp: fixtureTime(9)
    })
    const report = await reconcile()
    expect(runOf(run.runId)?.status).toBe('active')
    expect(report.endedRuns).toBe(0)
  })
})

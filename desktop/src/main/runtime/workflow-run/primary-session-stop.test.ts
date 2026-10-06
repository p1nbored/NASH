import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'
import { PRIMARY_STOP_GRACE_MS, createPrimarySessionStopper } from './primary-session-stop'
import {
  FIXTURE_HANDLE,
  FIXTURE_PANE,
  createFakeTerminal,
  fakeClock,
  seedPrimaryRun
} from './primary-session.test-fixture'

describe('stopping a primary session', () => {
  let db: OrchestrationDb
  let fake: ReturnType<typeof createFakeTerminal>
  let clock: ReturnType<typeof fakeClock>
  let exitWatches: {
    cancel: Mock<(ownerId: string) => void>
    watch: Mock<(owner: PrimarySessionRecord) => void>
  }

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    fake = createFakeTerminal()
    clock = fakeClock()
    exitWatches = { cancel: vi.fn(), watch: vi.fn() }
  })
  afterEach(() => db.close())

  const stopper = () =>
    createPrimarySessionStopper({ db, terminal: fake.terminal, clock, exitWatches })

  function seedBound(owner: 'running' | 'unverifiable' = 'running') {
    const seeded = seedPrimaryRun(db, { owner })
    db.bindRun({
      runId: seeded.run.runId,
      coordinatorHandle: FIXTURE_HANDLE,
      coordinatorPaneKey: FIXTURE_PANE
    })
    return seeded
  }

  it('interrupts, waits 5 seconds, then closes; the owner is stopped and its pane released', async () => {
    const { run, owner } = seedBound()
    const order: string[] = []
    fake.terminal.sendTerminal.mockImplementationOnce(async (handle) => {
      order.push('interrupt')
      return { handle, accepted: true, bytesWritten: 1 }
    })
    clock.sleep.mockImplementationOnce(async (ms) => {
      order.push(`sleep ${ms}`)
    })
    fake.terminal.closeTerminal.mockImplementationOnce(async (handle) => {
      order.push('close')
      return { handle, tabId: 't', ptyKilled: true }
    })
    const result = await stopper().stop(run.runId, 'user_canceled')
    expect(order).toEqual(['interrupt', `sleep ${PRIMARY_STOP_GRACE_MS}`, 'close'])
    expect(PRIMARY_STOP_GRACE_MS).toBe(5_000)
    expect(fake.terminal.sendTerminal).toHaveBeenCalledWith(
      FIXTURE_HANDLE,
      { interrupt: true },
      { inputKind: 'driving' }
    )
    expect(result).toMatchObject({
      outcome: 'stopped',
      owner: { state: 'stopped', endReason: 'user_canceled' }
    })
    expect(exitWatches.cancel).toHaveBeenCalledWith(owner!.ownerId)
    expect(db.getRun(run.runId)?.coordinator_pane_key).toBeNull()
  })

  it('refuses to touch a pane whose process identity does not match', async () => {
    const { run } = seedBound()
    fake.state.incarnations.set(FIXTURE_HANDLE, 'incarnation_reused')
    await expect(stopper().stop(run.runId, 'user_canceled')).resolves.toMatchObject({
      outcome: 'refused',
      code: 'autopilot_owner_identity_unverified',
      owner: { state: 'running' }
    })
    expect(fake.terminal.sendTerminal).not.toHaveBeenCalled()
    expect(fake.terminal.closeTerminal).not.toHaveBeenCalled()
  })

  it('refuses a run without a live owner and an owner still starting', async () => {
    const none = seedPrimaryRun(db, { owner: 'none' }).run
    await expect(stopper().stop(none.runId, 'user_canceled')).resolves.toMatchObject({
      outcome: 'refused',
      code: 'autopilot_owner_not_live',
      owner: null
    })
    const starting = seedPrimaryRun(db, { owner: 'starting', status: 'launching' }).run
    await expect(stopper().stop(starting.runId, 'user_canceled')).resolves.toMatchObject({
      outcome: 'refused',
      code: 'autopilot_owner_starting'
    })
  })

  it('records an unconfirmed stop as unverifiable and keeps the binding', async () => {
    const { run } = seedBound()
    fake.terminal.closeTerminal.mockResolvedValueOnce({
      handle: FIXTURE_HANDLE,
      tabId: 't',
      ptyKilled: false,
      ptyStopVerdict: 'unverifiable'
    })
    await expect(stopper().stop(run.runId, 'user_canceled')).resolves.toMatchObject({
      outcome: 'stop_unconfirmed',
      owner: { state: 'unverifiable', endReason: 'stop_unconfirmed' }
    })
    expect(db.getRun(run.runId)?.coordinator_pane_key).toBe(FIXTURE_PANE)
  })

  it('re-arms the exit watch of an owner whose stop was not confirmed', async () => {
    const { run, owner } = seedBound()
    fake.terminal.closeTerminal.mockResolvedValueOnce({
      handle: FIXTURE_HANDLE,
      tabId: 't',
      ptyKilled: false,
      ptyStopVerdict: 'unverifiable'
    })
    await stopper().stop(run.runId, 'user_canceled')
    expect(exitWatches.cancel).toHaveBeenCalledWith(owner!.ownerId)
    expect(exitWatches.watch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ ownerId: owner!.ownerId, state: 'unverifiable' })
    )
  })

  it('re-arms the exit watch when recording the stop fails after cancelling it', async () => {
    const { run, owner } = seedBound()
    vi.spyOn(getPrimarySessionStore(db), 'transition').mockImplementationOnce(() => {
      throw new Error('fixture write failure')
    })
    await expect(stopper().stop(run.runId, 'user_canceled')).rejects.toThrow(
      'fixture write failure'
    )
    expect(exitWatches.watch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ ownerId: owner!.ownerId, state: 'running' })
    )
    expect(fake.terminal.closeTerminal).not.toHaveBeenCalled()
  })

  it('does not re-arm the exit watch of an owner it stopped', async () => {
    const { run } = seedBound()
    await stopper().stop(run.runId, 'user_canceled')
    expect(exitWatches.watch).not.toHaveBeenCalled()
  })

  it('still closes when the interrupt keystroke could not be written', async () => {
    const { run } = seedBound()
    fake.terminal.sendTerminal.mockRejectedValueOnce(new Error('terminal_not_writable'))
    await expect(stopper().stop(run.runId, 'user_canceled')).resolves.toMatchObject({
      outcome: 'stopped'
    })
    expect(fake.terminal.closeTerminal).toHaveBeenCalledOnce()
  })

  it('records a close that throws as unconfirmed', async () => {
    const { run } = seedBound()
    fake.terminal.closeTerminal.mockRejectedValueOnce(new Error('terminal_gone'))
    await expect(stopper().stop(run.runId, 'user_canceled')).resolves.toMatchObject({
      outcome: 'stop_unconfirmed',
      owner: { state: 'unverifiable' }
    })
  })

  it('stops an unverifiable owner whose pane verifies again', async () => {
    const { run } = seedBound('unverifiable')
    await expect(stopper().stop(run.runId, 'user_canceled')).resolves.toMatchObject({
      outcome: 'stopped',
      owner: { state: 'stopped' }
    })
  })

  it('refuses a reason that is not a code', async () => {
    const { run } = seedBound()
    await expect(stopper().stop(run.runId, 'Because I said so')).resolves.toMatchObject({
      outcome: 'refused',
      code: 'autopilot_invalid_reason'
    })
    expect(getPrimarySessionStore(db).findLiveByRun(run.runId)?.state).toBe('running')
  })
})

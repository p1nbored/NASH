import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeTerminalWait } from '../../../shared/runtime-terminal-contracts'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { createPrimarySessionExitWatches } from './primary-session-exit-watch'
import {
  FIXTURE_HANDLE,
  FIXTURE_PANE,
  createFakeTerminal,
  fakeClock,
  seedPrimaryRun
} from './primary-session.test-fixture'

function exitWait(satisfied: boolean): RuntimeTerminalWait {
  return {
    handle: FIXTURE_HANDLE,
    condition: 'exit',
    satisfied,
    status: satisfied ? 'exited' : 'running',
    exitCode: satisfied ? 0 : null
  }
}

describe('primary session exit watch', () => {
  let db: OrchestrationDb
  let fake: ReturnType<typeof createFakeTerminal>

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    fake = createFakeTerminal()
  })
  afterEach(() => db.close())

  const watches = () =>
    createPrimarySessionExitWatches({ db, terminal: fake.terminal, clock: fakeClock() })

  function seedBound() {
    const seeded = seedPrimaryRun(db)
    db.bindRun({
      runId: seeded.run.runId,
      coordinatorHandle: FIXTURE_HANDLE,
      coordinatorPaneKey: FIXTURE_PANE
    })
    return { run: seeded.run, owner: seeded.owner! }
  }

  it('records an observed exit of the same process, fails the run and frees the pane', async () => {
    const { run, owner } = seedBound()
    fake.terminal.waitForTerminal.mockResolvedValueOnce(exitWait(true))
    const exitWatches = watches()
    exitWatches.watch(owner)
    await exitWatches.settled(owner.ownerId)
    expect(fake.terminal.waitForTerminal).toHaveBeenCalledWith(
      FIXTURE_HANDLE,
      expect.objectContaining({ condition: 'exit', signal: expect.any(AbortSignal) })
    )
    expect(getPrimarySessionStore(db).get(owner.ownerId)).toMatchObject({
      state: 'exited',
      endReason: 'primary_exited'
    })
    expect(getWorkflowRunStore(db).get(run.runId)).toMatchObject({
      status: 'failed',
      endReason: 'primary_exited'
    })
    expect(db.getRun(run.runId)?.coordinator_pane_key).toBeNull()
  })

  it('leaves a completing run to its own completion', async () => {
    const { run, owner } = seedBound()
    const runs = getWorkflowRunStore(db)
    runs.transition({
      runId: run.runId,
      from: 'active',
      to: 'completing',
      expectedRevision: runs.get(run.runId)!.revision,
      reason: null,
      timestamp: fixtureTime(9)
    })
    fake.terminal.waitForTerminal.mockResolvedValueOnce(exitWait(true))
    const exitWatches = watches()
    exitWatches.watch(owner)
    await exitWatches.settled(owner.ownerId)
    expect(runs.get(run.runId)?.status).toBe('completing')
    expect(getPrimarySessionStore(db).get(owner.ownerId)?.state).toBe('exited')
  })

  it.each([
    ['an unsatisfied wait', () => Promise.resolve(exitWait(false))],
    ['a wait that fails', () => Promise.reject(new Error('terminal_handle_stale'))]
  ])('changes nothing on %s: lost contact is never an exit', async (_label, wait) => {
    const { owner } = seedBound()
    fake.terminal.waitForTerminal.mockImplementationOnce(wait)
    const exitWatches = watches()
    exitWatches.watch(owner)
    await exitWatches.settled(owner.ownerId)
    expect(getPrimarySessionStore(db).get(owner.ownerId)?.state).toBe('running')
  })

  it('ignores an exit after the owner was stopped by the app', async () => {
    const { owner } = seedBound()
    let resolveWait: (wait: RuntimeTerminalWait) => void = () => undefined
    fake.terminal.waitForTerminal.mockImplementationOnce(
      () => new Promise((resolve) => (resolveWait = resolve))
    )
    const exitWatches = watches()
    exitWatches.watch(owner)
    const sessions = getPrimarySessionStore(db)
    sessions.transition({
      ownerId: owner.ownerId,
      from: 'running',
      to: 'stopping',
      reason: null,
      timestamp: fixtureTime(9)
    })
    sessions.transition({
      ownerId: owner.ownerId,
      from: 'stopping',
      to: 'stopped',
      reason: 'user_canceled',
      timestamp: fixtureTime(10)
    })
    resolveWait(exitWait(true))
    await exitWatches.settled(owner.ownerId)
    expect(sessions.get(owner.ownerId)).toMatchObject({
      state: 'stopped',
      endReason: 'user_canceled'
    })
  })

  it('aborts the wait on cancel and on cancelAll', async () => {
    const { owner } = seedBound()
    const exitWatches = watches()
    exitWatches.watch(owner)
    const signal = fake.terminal.waitForTerminal.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    exitWatches.cancel(owner.ownerId)
    expect(signal?.aborted).toBe(true)
    exitWatches.watch(owner)
    exitWatches.cancelAll()
    expect(fake.terminal.waitForTerminal.mock.calls[1][1]?.signal?.aborted).toBe(true)
  })

  describe('an observed exit that cannot be recorded at once', () => {
    afterEach(() => vi.restoreAllMocks())

    const conflict = () =>
      Object.assign(new Error('Fixture: run changed at C:\\private'), {
        code: 'autopilot_run_conflict'
      })

    it('reports the code and records the exit on a retry, finishing what the first try left', async () => {
      const { run, owner } = seedBound()
      fake.terminal.waitForTerminal.mockResolvedValueOnce(exitWait(true))
      vi.spyOn(getWorkflowRunStore(db), 'transition').mockImplementationOnce(() => {
        throw conflict()
      })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const clock = fakeClock()
      const exitWatches = createPrimarySessionExitWatches({ db, terminal: fake.terminal, clock })
      exitWatches.watch(owner)
      await exitWatches.settled(owner.ownerId)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('autopilot_run_conflict'))
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private')
      expect(clock.sleep).toHaveBeenCalled()
      expect(getPrimarySessionStore(db).get(owner.ownerId)).toMatchObject({
        state: 'exited',
        endReason: 'primary_exited'
      })
      expect(getWorkflowRunStore(db).get(run.runId)).toMatchObject({
        status: 'failed',
        endReason: 'primary_exited'
      })
      expect(db.getRun(run.runId)?.coordinator_pane_key).toBeNull()
    })

    it('settles the watch without a rejection when every retry fails', async () => {
      const { owner } = seedBound()
      fake.terminal.waitForTerminal.mockResolvedValueOnce(exitWait(true))
      vi.spyOn(getPrimarySessionStore(db), 'transition').mockImplementation(() => {
        throw conflict()
      })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const exitWatches = watches()
      exitWatches.watch(owner)
      await expect(exitWatches.settled(owner.ownerId)).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('primary_exit_unrecorded'))
      vi.restoreAllMocks()
      expect(getPrimarySessionStore(db).get(owner.ownerId)?.state).toBe('running')
    })

    it('stops retrying once the watch is cancelled', async () => {
      const { owner } = seedBound()
      fake.terminal.waitForTerminal.mockResolvedValueOnce(exitWait(true))
      const transition = vi
        .spyOn(getPrimarySessionStore(db), 'transition')
        .mockImplementation(() => {
          throw conflict()
        })
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const clock = fakeClock()
      const exitWatches = createPrimarySessionExitWatches({ db, terminal: fake.terminal, clock })
      clock.sleep.mockImplementationOnce(async () => exitWatches.cancel(owner.ownerId))
      exitWatches.watch(owner)
      const done = exitWatches.settled(owner.ownerId)
      await done
      expect(transition).toHaveBeenCalledOnce()
    })
  })

  it('does not watch a pane it cannot verify, nor the same owner twice', () => {
    const { owner } = seedBound()
    const exitWatches = watches()
    exitWatches.watch(owner)
    exitWatches.watch(owner)
    expect(fake.terminal.waitForTerminal).toHaveBeenCalledOnce()
    exitWatches.cancelAll()
    fake.state.incarnations.clear()
    watches().watch(owner)
    expect(fake.terminal.waitForTerminal).toHaveBeenCalledOnce()
  })
})

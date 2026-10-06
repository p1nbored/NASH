import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import {
  isPrimaryDialogOpen,
  promoteVerifiedOwner,
  readPrimarySessionStatus
} from './primary-session-status'
import {
  FIXTURE_HANDLE,
  FIXTURE_INCARNATION,
  FIXTURE_PANE,
  createFakeTerminal,
  seedPrimaryRun
} from './primary-session.test-fixture'

describe('primary session status', () => {
  let db: OrchestrationDb
  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })
  afterEach(() => db.close())

  it.each([
    ['working', 'working'],
    ['permission', 'dialog_open'],
    ['idle', 'idle'],
    [null, 'unknown']
  ] as const)('maps Orca status %s to %s for a verified pane', async (status, activity) => {
    const { owner } = seedPrimaryRun(db)
    const { terminal } = createFakeTerminal({ status })
    await expect(readPrimarySessionStatus(terminal, owner!)).resolves.toEqual({
      kind: 'live',
      handle: FIXTURE_HANDLE,
      activity
    })
  })

  it('re-resolves a stale handle by pane key when the incarnation still matches', async () => {
    const { owner } = seedPrimaryRun(db)
    const { terminal } = createFakeTerminal({
      incarnations: new Map([['term_reissued', FIXTURE_INCARNATION]]),
      panes: new Map([[FIXTURE_PANE, 'term_reissued']])
    })
    await expect(readPrimarySessionStatus(terminal, owner!)).resolves.toEqual({
      kind: 'live',
      handle: 'term_reissued',
      activity: 'idle'
    })
  })

  it('reads an incarnation mismatch as unverifiable, never exited', async () => {
    const { owner } = seedPrimaryRun(db)
    const { terminal } = createFakeTerminal({
      incarnations: new Map([[FIXTURE_HANDLE, 'incarnation_other']])
    })
    await expect(readPrimarySessionStatus(terminal, owner!)).resolves.toEqual({
      kind: 'unverifiable',
      reason: 'incarnation_mismatch'
    })
    expect(terminal.getTerminalAgentStatus).not.toHaveBeenCalled()
  })

  it('reads a pane it cannot find as unverifiable', async () => {
    const { owner } = seedPrimaryRun(db)
    const { terminal } = createFakeTerminal({ incarnations: new Map(), panes: new Map() })
    await expect(readPrimarySessionStatus(terminal, owner!)).resolves.toEqual({
      kind: 'unverifiable',
      reason: 'handle_unresolved'
    })
  })

  it('reads a status that throws as unverifiable', async () => {
    const { owner } = seedPrimaryRun(db)
    const { terminal } = createFakeTerminal()
    terminal.getTerminalAgentStatus.mockRejectedValueOnce(new Error('terminal_gone'))
    await expect(readPrimarySessionStatus(terminal, owner!)).resolves.toEqual({
      kind: 'unverifiable',
      reason: 'status_unreadable'
    })
  })

  it('reports a verified pane without a running agent as agent_absent', async () => {
    const { owner } = seedPrimaryRun(db)
    const { terminal } = createFakeTerminal({ isRunningAgent: false })
    await expect(readPrimarySessionStatus(terminal, owner!)).resolves.toEqual({
      kind: 'agent_absent',
      handle: FIXTURE_HANDLE
    })
  })

  it('reports starting and ended owners without touching the terminal', async () => {
    const starting = seedPrimaryRun(db, { owner: 'starting' }).owner!
    const { terminal } = createFakeTerminal()
    await expect(readPrimarySessionStatus(terminal, starting)).resolves.toEqual({
      kind: 'starting'
    })
    const sessions = getPrimarySessionStore(db)
    const stopped = sessions.transition({
      ownerId: starting.ownerId,
      from: 'starting',
      to: 'stopped',
      reason: 'launch_failed_no_effects',
      timestamp: fixtureTime(5)
    })
    await expect(readPrimarySessionStatus(terminal, stopped)).resolves.toEqual({
      kind: 'ended',
      state: 'stopped'
    })
    expect(terminal.getTerminalProcessIncarnation).not.toHaveBeenCalled()
  })

  it('names only a live dialog_open status as an open dialog', () => {
    expect(isPrimaryDialogOpen({ kind: 'live', handle: 'h', activity: 'dialog_open' })).toBe(true)
    expect(isPrimaryDialogOpen({ kind: 'live', handle: 'h', activity: 'working' })).toBe(false)
    expect(isPrimaryDialogOpen({ kind: 'unverifiable', reason: 'handle_unresolved' })).toBe(false)
  })

  it('moves an unverifiable owner back to running only on a verified read', async () => {
    const { owner } = seedPrimaryRun(db, { owner: 'unverifiable' })
    const sessions = getPrimarySessionStore(db)
    const unverified = promoteVerifiedOwner(
      sessions,
      owner!,
      { kind: 'unverifiable', reason: 'handle_unresolved' },
      fixtureTime(9)
    )
    expect(unverified.state).toBe('unverifiable')
    const promoted = promoteVerifiedOwner(
      sessions,
      owner!,
      { kind: 'live', handle: FIXTURE_HANDLE, activity: 'idle' },
      fixtureTime(9)
    )
    expect(promoted.state).toBe('running')
    expect(
      promoteVerifiedOwner(
        sessions,
        promoted,
        { kind: 'live', handle: FIXTURE_HANDLE, activity: 'idle' },
        fixtureTime(10)
      )
    ).toEqual(promoted)
  })
})

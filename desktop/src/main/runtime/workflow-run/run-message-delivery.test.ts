import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getRunMessageStore } from '../orchestration/db/run-message-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { createRunMessageDelivery, type RunMessageDelivery } from './run-message-delivery'
import { createFakeTerminal, fakeClock, seedPrimaryRun } from './primary-session.test-fixture'
import {
  createIntakeEvidenceTables,
  manualTimers,
  recordIntakePrincipal
} from './run-message.test-fixture'

// FIXTURE_ONLY: the credential-shaped text below is synthetic.
const FAKE_SECRET_TEXT = 'Use password=correct-horse-battery for the call.'

describe('run message delivery', () => {
  let db: OrchestrationDb
  let fake: ReturnType<typeof createFakeTerminal>
  let clock: ReturnType<typeof fakeClock>
  let timers: ReturnType<typeof manualTimers>
  let delivery: RunMessageDelivery
  let runId: string
  let requestCounter: number

  function build(): RunMessageDelivery {
    return createRunMessageDelivery({
      db,
      terminal: fake.terminal,
      clock,
      newRequestId: () => `send-${++requestCounter}`,
      timers: timers.timers
    })
  }

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    fake = createFakeTerminal()
    clock = fakeClock()
    timers = manualTimers()
    requestCounter = 0
    runId = seedPrimaryRun(db).run.runId
    delivery = build()
  })
  afterEach(() => {
    delivery.dispose()
    db.close()
  })

  const send = (sourceRequestId: string, text = 'Please also check the README.') =>
    delivery.deliver({ runId, source: 'desktop', sourceRequestId, text })

  it('types into an idle primary and reports delivered', async () => {
    await expect(send('m1')).resolves.toMatchObject({
      outcome: 'delivered',
      reason: null,
      state: 'delivered',
      duplicate: false
    })
    expect(fake.terminal.sendTerminalAgentPrompt).toHaveBeenCalledWith(
      expect.any(String),
      'Please also check the README.',
      expect.objectContaining({ inputKind: 'driving', acceptQueued: true })
    )
    expect(getRunMessageStore(db).findBySource('desktop', 'm1')).toMatchObject({
      state: 'delivered',
      outcome: 'delivered'
    })
  })

  it.each(['working', null] as const)(
    'reports queued while the agent is %s, and still types it',
    async (status) => {
      fake.state.status = status
      await expect(send('m1')).resolves.toMatchObject({
        outcome: 'queued',
        reason: 'agent_busy',
        state: 'delivered'
      })
      expect(fake.terminal.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    }
  )

  it('never types while a dialog is open, then flushes held messages in order', async () => {
    fake.state.status = 'permission'
    await expect(send('m1', 'First follow-up.')).resolves.toMatchObject({
      outcome: 'queued',
      reason: 'dialog_open',
      state: 'held'
    })
    await expect(send('m2', 'Second follow-up.')).resolves.toMatchObject({
      outcome: 'queued',
      state: 'held'
    })
    expect(fake.terminal.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    expect(timers.pendingCount()).toBe(1)

    timers.fireAll()
    await delivery.drain(runId)
    expect(fake.terminal.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    expect(timers.pendingCount()).toBe(1)

    fake.state.status = 'idle'
    delivery.notifyPrimaryStatusChanged(runId)
    await delivery.drain(runId)
    expect(fake.terminal.sendTerminalAgentPrompt.mock.calls.map((call) => call[1])).toEqual([
      'First follow-up.',
      'Second follow-up.'
    ])
    const store = getRunMessageStore(db)
    expect(store.findBySource('desktop', 'm1')).toMatchObject({
      state: 'delivered',
      outcome: 'queued'
    })
    expect(store.countHeld(runId)).toBe(0)
    expect(timers.pendingCount()).toBe(0)
  })

  it('stops a flush at a dialog that opens part way through', async () => {
    fake.state.status = 'permission'
    await send('m1', 'First.')
    await send('m2', 'Second.')
    fake.state.status = 'idle'
    fake.terminal.sendTerminalAgentPrompt.mockImplementationOnce(async (handle, prompt) => ({
      handle,
      accepted: true,
      bytesWritten: prompt.length
    }))
    fake.terminal.sendTerminalAgentPrompt.mockRejectedValueOnce(new Error('agent_prompt_blocked'))
    await delivery.flushHeld(runId)
    const store = getRunMessageStore(db)
    expect(store.findBySource('desktop', 'm1')?.state).toBe('delivered')
    expect(store.findBySource('desktop', 'm2')?.state).toBe('held')
    expect(timers.pendingCount()).toBe(1)
  })

  it('holds a new message behind held ones so order is kept', async () => {
    fake.state.status = 'permission'
    await send('m1', 'First.')
    await expect(send('m2', 'Second.')).resolves.toMatchObject({
      outcome: 'queued',
      reason: 'behind_held_message'
    })
  })

  it('holds any number of messages while a dialog is open and types them all in order (D-027)', async () => {
    fake.state.status = 'permission'
    for (let index = 0; index < 40; index += 1) {
      await expect(send(`m${index}`, `Message number ${index}.`)).resolves.toMatchObject({
        outcome: 'queued',
        state: 'held'
      })
    }
    fake.state.status = 'idle'
    await delivery.flushHeld(runId)
    await delivery.flushHeld(runId)
    expect(fake.terminal.sendTerminalAgentPrompt).toHaveBeenCalledTimes(40)
    expect(getRunMessageStore(db).findBySource('desktop', 'm39')?.state).toBe('delivered')
  })

  it('returns the first outcome for a replay and types nothing twice', async () => {
    fake.state.status = 'permission'
    const first = await send('m1')
    fake.state.status = 'idle'
    await delivery.flushHeld(runId)
    const replay = await send('m1')
    expect(replay).toMatchObject({
      outcome: first.outcome,
      messageId: first.messageId,
      state: 'delivered',
      duplicate: true
    })
    expect(fake.terminal.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
  })

  it('refuses a reused request id with other text and stores nothing new', async () => {
    await send('m1', 'Original text.')
    await expect(send('m1', 'Different text.')).resolves.toMatchObject({
      outcome: 'refused',
      reason: 'request_id_reused',
      messageId: null,
      duplicate: false
    })
    expect(getRunMessageStore(db).findBySource('desktop', 'm1')?.text).toBe('Original text.')
  })

  it.each([
    [FAKE_SECRET_TEXT, FAKE_SECRET_TEXT],
    ['End the paste \u001b[201~ early.', 'End the paste ␛[201~ early.']
  ])(
    'types %j with terminal controls neutralised and stores what it typed (D-027 restriction 35)',
    async (text, typed) => {
      await expect(send('m1', text)).resolves.toMatchObject({ outcome: 'delivered' })
      expect(fake.terminal.sendTerminalAgentPrompt).toHaveBeenCalledWith(
        expect.any(String),
        typed,
        expect.anything()
      )
      expect(getRunMessageStore(db).findBySource('desktop', 'm1')?.text).toBe(typed)
    }
  )

  it.each([['', 'text_empty']])(
    'refuses %j as %s, stores no text and never reads the terminal',
    async (text, reason) => {
      await expect(send('bad', text)).resolves.toMatchObject({ outcome: 'refused', reason })
      expect(getRunMessageStore(db).findBySource('desktop', 'bad')).toMatchObject({
        state: 'refused',
        text: null
      })
      expect(fake.terminal.getTerminalAgentStatus).not.toHaveBeenCalled()
      expect(fake.terminal.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    }
  )

  it('refuses a missing run without storing anything', async () => {
    await expect(
      delivery.deliver({
        runId: 'run_missing',
        source: 'desktop',
        sourceRequestId: 'm1',
        text: 'Hi there.'
      })
    ).resolves.toMatchObject({ outcome: 'refused', reason: 'run_not_found', messageId: null })
  })

  it('refuses malformed input without storing anything', async () => {
    await expect(
      delivery.deliver({
        runId,
        source: 'desktop',
        sourceRequestId: 'has space',
        text: 'Hi there.'
      })
    ).resolves.toMatchObject({ outcome: 'refused', reason: 'invalid_request', messageId: null })
  })

  it('refuses a run that is not active', async () => {
    const launching = seedPrimaryRun(db, { status: 'launching', owner: 'none' }).run
    await expect(
      delivery.deliver({
        runId: launching.runId,
        source: 'desktop',
        sourceRequestId: 'm1',
        text: 'Hi there.'
      })
    ).resolves.toMatchObject({ outcome: 'refused', reason: 'run_not_active', state: 'refused' })
  })

  describe('dot may message only the runs dot started', () => {
    beforeEach(() => createIntakeEvidenceTables(db))
    const fromDot = (id: string) =>
      delivery.deliver({ runId, source: 'dot', sourceRequestId: id, text: 'Hi from dot.' })

    it('refuses an origin-only Dot record without current workspace control', async () => {
      recordIntakePrincipal(db, getWorkflowRunStore(db).get(runId)!.requestId, 'dot-ingress')
      await expect(fromDot('d1')).resolves.toMatchObject({
        outcome: 'refused',
        reason: 'run_not_owned_by_source'
      })
      expect(getRunMessageStore(db).findBySource('dot', 'd1')?.state).toBe('refused')
    })

    it.each(['local-desktop-ui', null])('refuses a run with principal %s', async (principal) => {
      if (principal) {
        recordIntakePrincipal(db, getWorkflowRunStore(db).get(runId)!.requestId, principal)
      }
      await expect(fromDot('d1')).resolves.toMatchObject({
        outcome: 'refused',
        reason: 'run_not_owned_by_source'
      })
      expect(fake.terminal.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    })
  })

  it('refuses when the run has no live primary', async () => {
    const run = seedPrimaryRun(db, { owner: 'none' }).run
    await expect(
      delivery.deliver({
        runId: run.runId,
        source: 'desktop',
        sourceRequestId: 'm1',
        text: 'Hi there.'
      })
    ).resolves.toMatchObject({ outcome: 'refused', reason: 'primary_not_live' })
  })

  it.each([
    ['an unverifiable pane', () => fake.state.incarnations.clear()],
    ['a pane without a running agent', () => (fake.state.isRunningAgent = false)]
  ])('refuses %s as primary_not_live', async (_label, arrange) => {
    arrange()
    await expect(send('m1')).resolves.toMatchObject({
      outcome: 'refused',
      reason: 'primary_not_live'
    })
    expect(fake.terminal.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  it('promotes an unverifiable owner whose pane verifies, then delivers', async () => {
    const sessions = getPrimarySessionStore(db)
    sessions.transition({
      ownerId: sessions.findLiveByRun(runId)!.ownerId,
      from: 'running',
      to: 'unverifiable',
      reason: 'reconciled_after_restart',
      timestamp: fixtureTime(5)
    })
    await expect(send('m1')).resolves.toMatchObject({ outcome: 'delivered' })
    expect(sessions.findLiveByRun(runId)?.state).toBe('running')
  })

  it.each([
    [new Error('agent_prompt_blocked'), 'queued', 'held', 'dialog_open'],
    [new Error('terminal_not_writable'), 'refused', 'refused', 'terminal_unavailable']
  ])('maps a send failure %s', async (error, outcome, state, reason) => {
    fake.terminal.sendTerminalAgentPrompt.mockRejectedValueOnce(error)
    await expect(send('m1')).resolves.toMatchObject({ outcome, state, reason })
  })

  it('never retypes a message whose paste may be in the composer', async () => {
    fake.terminal.sendTerminalAgentPrompt.mockImplementationOnce(async (_h, _p, options) => {
      await options.beforeWrite?.('pty')
      await options.beforeWrite?.('pty')
      throw new Error('agent_prompt_blocked')
    })
    await expect(send('m1')).resolves.toMatchObject({
      outcome: 'refused',
      reason: 'delivery_incomplete'
    })
    expect(timers.pendingCount()).toBe(0)
  })

  it('refuses held messages once the run is no longer active', async () => {
    fake.state.status = 'permission'
    await send('m1')
    const runs = getWorkflowRunStore(db)
    const run = runs.get(runId)!
    runs.transition({
      runId,
      from: 'active',
      to: 'canceled',
      expectedRevision: run.revision,
      reason: 'user_canceled',
      timestamp: fixtureTime(30)
    })
    timers.fireAll()
    await delivery.drain(runId)
    expect(getRunMessageStore(db).findBySource('desktop', 'm1')).toMatchObject({
      state: 'refused',
      outcome: 'queued',
      reason: 'run_not_active'
    })
    expect(timers.pendingCount()).toBe(0)
  })

  it('refuses held messages once the primary is gone, but waits while it is only unverifiable', async () => {
    fake.state.status = 'permission'
    await send('m1')
    fake.state.incarnations.clear()
    await delivery.flushHeld(runId)
    expect(getRunMessageStore(db).findBySource('desktop', 'm1')?.state).toBe('held')
    fake.state.incarnations.set('term_primary_a', 'incarnation_a')
    fake.state.isRunningAgent = false
    await delivery.flushHeld(runId)
    expect(getRunMessageStore(db).findBySource('desktop', 'm1')).toMatchObject({
      state: 'refused',
      reason: 'primary_not_live'
    })
  })

  it('keeps a held message however long the dialog stays open, then delivers it (D-027)', async () => {
    fake.state.status = 'permission'
    await send('m1')
    clock.advance(6 * 60 * 60_000)
    await delivery.flushHeld(runId)
    expect(getRunMessageStore(db).findBySource('desktop', 'm1')?.state).toBe('held')
    fake.state.status = 'idle'
    await delivery.flushHeld(runId)
    expect(getRunMessageStore(db).findBySource('desktop', 'm1')?.state).toBe('delivered')
  })

  it('accepts a message in any language (D-027)', async () => {
    await expect(send('zh', '请检查文件。')).resolves.toMatchObject({ outcome: 'delivered' })
  })

  it('settles messages a restart left in flight as unconfirmed, never retyped', () => {
    getRunMessageStore(db).recordReceived({
      runId,
      source: 'dot',
      sourceRequestId: 'inflight',
      text: 'Lost in a crash.',
      textSha256: 'c'.repeat(64),
      timestamp: fixtureTime(1)
    })
    expect(delivery.settleInterrupted()).toBe(1)
    expect(getRunMessageStore(db).findBySource('dot', 'inflight')).toMatchObject({
      state: 'refused',
      outcome: 'refused',
      reason: 'delivery_unconfirmed'
    })
    expect(fake.terminal.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  it('serializes deliveries per run so a later message cannot overtake an earlier one', async () => {
    let release: () => void = () => undefined
    fake.terminal.sendTerminalAgentPrompt.mockImplementationOnce(
      (handle, prompt) =>
        new Promise((resolve) => {
          release = () => resolve({ handle, accepted: true, bytesWritten: prompt.length })
        })
    )
    const first = send('m1', 'First.')
    const second = send('m2', 'Second.')
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(fake.terminal.sendTerminalAgentPrompt).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])
    expect(fake.terminal.sendTerminalAgentPrompt.mock.calls.map((call) => call[1])).toEqual([
      'First.',
      'Second.'
    ])
  })

  it('dispose clears pending flush timers', async () => {
    fake.state.status = 'permission'
    await send('m1')
    expect(timers.pendingCount()).toBe(1)
    delivery.dispose()
    expect(timers.pendingCount()).toBe(0)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StatusRowMutationListener } from '../../agent-hooks/server/server-types'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getRunMessageStore } from '../orchestration/db/run-message-store'
import { createRunMessageDelivery } from './run-message-delivery'
import { createRunFlushTimers } from './run-message-scheduling'
import {
  createFakeTerminal,
  fakeClock,
  FIXTURE_HANDLE,
  FIXTURE_PANE,
  seedPrimaryRun
} from './primary-session.test-fixture'
import { manualTimers } from './run-message.test-fixture'

describe('native run message status events', () => {
  const cleanup: (() => void)[] = []
  afterEach(() => {
    for (const dispose of cleanup.splice(0).toReversed()) {
      dispose()
    }
  })

  it.each([
    { before: { paneKey: FIXTURE_PANE }, after: null },
    { before: null, after: { paneKey: 'moved-pane', terminalHandle: FIXTURE_HANDLE } }
  ])(
    'flushes matching native mutations immediately and unsubscribes at disposal: %j',
    async (mutation) => {
      const db = new OrchestrationDb(':memory:')
      cleanup.push(() => db.close())
      const fake = createFakeTerminal({ status: 'permission' })
      const runId = seedPrimaryRun(db).run.runId
      const timers = manualTimers()
      const listeners = new Set<StatusRowMutationListener>()
      const unsubscribe = vi.fn()
      const delivery = createRunMessageDelivery({
        db,
        terminal: fake.terminal,
        clock: fakeClock(),
        newRequestId: () => 'send-1',
        timers: timers.timers,
        primaryStatusChanges: {
          subscribeStatusRowMutations(listener: StatusRowMutationListener) {
            listeners.add(listener)
            return () => {
              listeners.delete(listener)
              unsubscribe()
            }
          }
        }
      })
      cleanup.push(() => delivery.dispose())
      await delivery.deliver({ runId, source: 'desktop', sourceRequestId: 'm1', text: 'Follow up' })
      fake.state.status = 'idle'
      fake.terminal.getTerminalAgentStatus.mockClear()
      for (const listener of listeners) {
        listener({ before: null, after: { paneKey: 'unrelated' } })
      }
      await delivery.drain(runId)
      expect(fake.terminal.getTerminalAgentStatus).not.toHaveBeenCalled()
      for (const listener of listeners) {
        listener(mutation)
      }
      await delivery.drain(runId)
      expect(getRunMessageStore(db).findBySource('desktop', 'm1')?.state).toBe('delivered')
      expect(timers.pendingCount()).toBe(0)
      delivery.dispose()
      delivery.dispose()
      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(listeners.size).toBe(0)
    }
  )

  it('ignores an event flush queued just before shutdown', async () => {
    const db = new OrchestrationDb(':memory:')
    cleanup.push(() => db.close())
    const fake = createFakeTerminal({ status: 'permission' })
    const runId = seedPrimaryRun(db).run.runId
    const delivery = createRunMessageDelivery({
      db,
      terminal: fake.terminal,
      clock: fakeClock(),
      newRequestId: () => 'send-1',
      timers: manualTimers().timers
    })
    cleanup.push(() => delivery.dispose())
    await delivery.deliver({ runId, source: 'desktop', sourceRequestId: 'm1', text: 'Follow up' })
    fake.state.status = 'idle'
    delivery.notifyPrimaryStatusChanged(runId)
    delivery.dispose()
    await delivery.drain(runId)
    expect(fake.terminal.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    expect(getRunMessageStore(db).findBySource('desktop', 'm1')?.state).toBe('held')
  })

  it('shares one fallback timer across runs and cancels it when the last run clears', () => {
    const timers = manualTimers()
    const scheduler = createRunFlushTimers(timers.timers, 2000)
    const first = vi.fn()
    const second = vi.fn()
    scheduler.arm('first', first)
    scheduler.arm('second', second)
    expect(timers.pendingCount()).toBe(1)
    scheduler.cancel('first')
    timers.fireAll()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    scheduler.arm('first', first)
    scheduler.cancel('first')
    expect(timers.pendingCount()).toBe(0)
    scheduler.dispose()
    scheduler.arm('second', second)
    expect(timers.pendingCount()).toBe(0)
  })
})

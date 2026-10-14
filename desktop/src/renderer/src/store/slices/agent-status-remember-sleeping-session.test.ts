import { describe, expect, it } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import { createTestStore } from './store-test-helpers'

function record(overrides: Partial<SleepingAgentSessionRecord> = {}): SleepingAgentSessionRecord {
  return {
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    agent: 'claude',
    providerSession: { key: 'session_id', id: 'deferred-session' },
    prompt: '',
    state: 'done',
    capturedAt: 1,
    updatedAt: 1,
    origin: 'live',
    restoreOnTabOpenOnly: true,
    ...overrides
  }
}

describe('rememberSleepingAgentSession', () => {
  it('keeps the resume handle of a pane whose restore was deferred', () => {
    const store = createTestStore()
    store.getState().rememberSleepingAgentSession(record())
    expect(store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']).toEqual(record())
  })

  it('never replaces a record the pane already has', () => {
    const store = createTestStore()
    const existing = record({ prompt: 'the original task', origin: 'quit' })
    store.getState().rememberSleepingAgentSession(existing)
    store.getState().rememberSleepingAgentSession(record())
    expect(store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']).toBe(existing)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { RUN_MESSAGE_TEXT_MAX_CHARS } from './autopilot-message-schema-definition'
import {
  FIXTURE_HASH_A,
  FIXTURE_HASH_B,
  errorCodeOf,
  fixtureTime,
  insertRawRun
} from './autopilot-runtime.test-fixture'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import { getRunMessageStore, type RunMessageStore } from './run-message-store'

const RUN = 'run_message01'

function received(store: RunMessageStore, sourceRequestId: string, runId = RUN) {
  return store.recordReceived({
    runId,
    source: 'dot',
    sourceRequestId,
    text: 'Please also check the README.',
    textSha256: FIXTURE_HASH_A,
    timestamp: fixtureTime(1)
  })
}

describe('run message store', () => {
  let owner: OrchestrationDb
  let store: RunMessageStore
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ensureAutopilotRuntimeSchema(owner.db)
    insertRawRun(owner.db, RUN, 'request_message01')
    insertRawRun(owner.db, 'run_message02', 'request_message02')
    store = getRunMessageStore(owner)
  })
  afterEach(() => owner.close())

  it('records a received message and finds it by source and request id', () => {
    const record = received(store, 'dot-request-1')
    expect(record).toMatchObject({
      runId: RUN,
      source: 'dot',
      sourceRequestId: 'dot-request-1',
      text: 'Please also check the README.',
      state: 'received',
      outcome: null,
      reason: null,
      deliveredAt: null
    })
    expect(store.findBySource('dot', 'dot-request-1')).toEqual(record)
    expect(store.findBySource('desktop', 'dot-request-1')).toBeNull()
  })

  it('keeps one message per source and request id, across runs too', () => {
    received(store, 'dot-request-1')
    expect(errorCodeOf(() => received(store, 'dot-request-1', 'run_message02'))).toBe(
      'autopilot_message_conflict'
    )
    expect(
      store.recordReceived({
        runId: RUN,
        source: 'desktop',
        sourceRequestId: 'dot-request-1',
        text: 'Same id from another source.',
        textSha256: FIXTURE_HASH_B,
        timestamp: fixtureTime(2)
      }).source
    ).toBe('desktop')
  })

  it('refuses a message for a run that does not exist', () => {
    expect(errorCodeOf(() => received(store, 'dot-request-1', 'run_missing'))).toBe(
      'autopilot_run_not_found'
    )
  })

  it('lists held messages per run in arrival order and counts them', () => {
    for (const id of ['held-1', 'held-2', 'held-3']) {
      store.recordHeld({
        runId: RUN,
        source: 'desktop',
        sourceRequestId: id,
        text: `Message ${id}.`,
        textSha256: FIXTURE_HASH_A,
        reason: 'dialog_open',
        timestamp: fixtureTime(3)
      })
    }
    received(store, 'other-run', 'run_message02')
    expect(store.listHeld(RUN, 10).map((message) => message.sourceRequestId)).toEqual([
      'held-1',
      'held-2',
      'held-3'
    ])
    expect(store.listHeld(RUN, 10).every((message) => message.outcome === 'queued')).toBe(true)
    expect(store.countHeld(RUN)).toBe(3)
    expect(store.countHeld('run_message02')).toBe(0)
  })

  it('settles a received message once and keeps its first outcome', () => {
    const record = received(store, 'dot-request-1')
    const delivered = store.settle(record.messageId, {
      to: 'delivered',
      firstOutcome: 'queued',
      reason: 'agent_busy',
      timestamp: fixtureTime(4)
    })
    expect(delivered).toMatchObject({
      state: 'delivered',
      outcome: 'queued',
      reason: 'agent_busy',
      deliveredAt: fixtureTime(4)
    })
    expect(
      errorCodeOf(() =>
        store.settle(record.messageId, {
          to: 'refused',
          firstOutcome: 'refused',
          reason: 'run_not_active',
          timestamp: fixtureTime(5)
        })
      )
    ).toBe('autopilot_message_conflict')
  })

  it('keeps queued as the first outcome when a held message is delivered or refused later', () => {
    const held = store.recordHeld({
      runId: RUN,
      source: 'dot',
      sourceRequestId: 'held-1',
      text: 'Wait for the dialog.',
      textSha256: FIXTURE_HASH_A,
      reason: 'dialog_open',
      timestamp: fixtureTime(1)
    })
    const delivered = store.settle(held.messageId, {
      to: 'delivered',
      firstOutcome: 'delivered',
      reason: null,
      timestamp: fixtureTime(2)
    })
    expect(delivered).toMatchObject({ state: 'delivered', outcome: 'queued', reason: null })
    const other = store.recordHeld({
      runId: RUN,
      source: 'dot',
      sourceRequestId: 'held-2',
      text: 'Wait again.',
      textSha256: FIXTURE_HASH_A,
      reason: 'dialog_open',
      timestamp: fixtureTime(3)
    })
    expect(
      store.settle(other.messageId, {
        to: 'refused',
        firstOutcome: 'refused',
        reason: 'hold_expired',
        timestamp: fixtureTime(4)
      })
    ).toMatchObject({ state: 'refused', outcome: 'queued', reason: 'hold_expired' })
  })

  it('refuses a held message going back to received and a refusal without a reason code', () => {
    const record = received(store, 'dot-request-1')
    expect(
      errorCodeOf(() =>
        store.settle(record.messageId, {
          to: 'refused',
          firstOutcome: 'refused',
          reason: 'Free text reason',
          timestamp: fixtureTime(2)
        })
      )
    ).toBe('autopilot_invalid_input')
    expect(
      errorCodeOf(() =>
        store.settle(record.messageId, {
          to: 'held',
          firstOutcome: 'queued',
          reason: null,
          timestamp: fixtureTime(2)
        })
      )
    ).toBe('autopilot_invalid_reason')
  })

  it('still stores a historic secret_shaped refusal (no longer produced since D-027) without its text', () => {
    const refused = store.recordRefused({
      runId: RUN,
      source: 'dot',
      sourceRequestId: 'secret-1',
      text: null,
      textSha256: FIXTURE_HASH_B,
      reason: 'secret_shaped',
      timestamp: fixtureTime(1)
    })
    expect(refused).toMatchObject({ state: 'refused', outcome: 'refused', text: null })
  })

  it('stores text past the old 4,000 code points, up to the technical ceiling (D-027)', () => {
    const text = 'b'.repeat(RUN_MESSAGE_TEXT_MAX_CHARS)
    const record = store.recordReceived({
      runId: RUN,
      source: 'dot',
      sourceRequestId: 'long-ok',
      text,
      textSha256: FIXTURE_HASH_A,
      timestamp: fixtureTime(1)
    })
    expect(RUN_MESSAGE_TEXT_MAX_CHARS).toBeGreaterThan(4_000)
    expect(record.text).toBe(text)
  })

  it('refuses text over the cap at the store boundary', () => {
    expect(
      errorCodeOf(() =>
        store.recordReceived({
          runId: RUN,
          source: 'dot',
          sourceRequestId: 'long-1',
          text: 'a'.repeat(RUN_MESSAGE_TEXT_MAX_CHARS + 1),
          textSha256: FIXTURE_HASH_A,
          timestamp: fixtureTime(1)
        })
      )
    ).toBe('autopilot_invalid_input')
  })

  describe('the table refuses what the store would never write', () => {
    const insert = (text: string | null, state: string, outcome: string | null) =>
      owner.db
        .prepare(
          `INSERT INTO run_messages (message_id, run_id, source, source_request_id, text, text_sha256,
            state, outcome, reason, created_at, updated_at) VALUES (?, ?, 'dot', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `message_${Math.random()}`,
          RUN,
          `raw-${Math.random()}`,
          text,
          FIXTURE_HASH_A,
          state,
          outcome,
          state === 'refused' || state === 'held' ? 'raw_reason' : null,
          fixtureTime(),
          fixtureTime()
        )

    it.each([
      ['an escape character', 'before \u001b[31m after', 'received', null],
      ['a carriage return', 'line one\r\nline two', 'received', null],
      ['no text outside a refusal', null, 'held', 'queued'],
      ['a received row with an outcome', 'Hello.', 'received', 'queued'],
      ['a held row without an outcome', 'Hello.', 'held', null],
      ['an unknown state', 'Hello.', 'sent', 'queued']
    ])('%s', (_label, text, state, outcome) => {
      expect(() => insert(text, state, outcome)).toThrow(/constraint/i)
    })

    it('accepts a newline inside the text', () => {
      expect(() => insert('line one\nline two', 'received', null)).not.toThrow()
    })
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { getDotIngressSettingsStore } from './dot-ingress-settings-store'
import { getDotIngressStore, type DotIngressStore } from './dot-ingress-store'
import {
  enableFixtureInterface,
  errorCodeOf,
  errorDataOf,
  fixtureTime,
  fixtureUuid,
  insertRawRequestRows,
  submitInput
} from './dot-ingress.test-fixture'

const DAY_SECONDS = 24 * 60 * 60

describe('dot ingress request store: submission caps and capacity', () => {
  let owner: OrchestrationDb
  let store: DotIngressStore
  let settings: ReturnType<typeof getDotIngressSettingsStore>
  let ref: string
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ref = enableFixtureInterface(owner)
    store = getDotIngressStore(owner)
    settings = getDotIngressSettingsStore(owner)
  })
  afterEach(() => owner.close())

  const count = (table: string): unknown =>
    owner.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n
  const key = (n: number) => ({ idempotencyKey: fixtureUuid(n) })
  /** Lifts the per-minute and per-day caps so a test about something else is not stopped by them. */
  const liftCaps = () =>
    settings.setRateLimits({ ratePerMinute: 60, ratePerUtcDay: 10_000, timestamp: fixtureTime(1) })

  describe('rail 2: submission caps (defaults the user can change)', () => {
    const submitAt = (n: number, seconds: number) =>
      store.submit(
        submitInput(ref, {
          objective: `Task ${n}.`,
          ...key(100 + n),
          timestamp: fixtureTime(seconds)
        })
      )

    it('allows 6 submissions in a minute by default and refuses the 7th with dot_rate_limited', () => {
      for (let n = 0; n < 6; n += 1) {
        submitAt(n, 10 + n)
      }
      expect(errorCodeOf(() => submitAt(6, 20))).toBe('dot_rate_limited')
      expect(count('dot_ingress_requests')).toBe(6)
    })

    it('says which window was hit, without any request text', () => {
      for (let n = 0; n < 6; n += 1) {
        submitAt(n, 10 + n)
      }
      expect(errorDataOf(() => submitAt(6, 20))).toEqual({ window: 'minute' })
    })

    it('counts a sliding minute: the oldest submission leaves the window after 60 seconds', () => {
      for (let n = 0; n < 6; n += 1) {
        submitAt(n, 10 + n)
      }
      expect(errorCodeOf(() => submitAt(6, 69))).toBe('dot_rate_limited')
      expect(submitAt(6, 70).duplicate).toBe(false)
      expect(errorCodeOf(() => submitAt(7, 70))).toBe('dot_rate_limited')
    })

    it('applies the cap the user sets, at once, in both directions', () => {
      settings.setRateLimits({ ratePerMinute: 2, ratePerUtcDay: 100, timestamp: fixtureTime(1) })
      submitAt(0, 10)
      submitAt(1, 11)
      expect(errorCodeOf(() => submitAt(2, 12))).toBe('dot_rate_limited')
      settings.setRateLimits({ ratePerMinute: 3, ratePerUtcDay: 100, timestamp: fixtureTime(13) })
      expect(submitAt(2, 14).duplicate).toBe(false)
    })

    it('counts a UTC day and starts a new one at midnight UTC', () => {
      settings.setRateLimits({ ratePerMinute: 60, ratePerUtcDay: 3, timestamp: fixtureTime(1) })
      submitAt(0, 100)
      submitAt(1, 5_000)
      submitAt(2, DAY_SECONDS - 1)
      expect(errorCodeOf(() => submitAt(3, DAY_SECONDS - 1))).toBe('dot_rate_limited')
      expect(errorDataOf(() => submitAt(3, DAY_SECONDS - 1))).toEqual({ window: 'utc_day' })
      expect(submitAt(3, DAY_SECONDS).duplicate).toBe(false)
      expect(submitAt(4, DAY_SECONDS + 1).duplicate).toBe(false)
    })

    it('does not count a replay, so a retry at the cap still returns the stored request', () => {
      for (let n = 0; n < 6; n += 1) {
        submitAt(n, 10 + n)
      }
      const replay = store.submit(
        submitInput(ref, { objective: 'Task 3.', ...key(103), timestamp: fixtureTime(30) })
      )
      expect(replay.duplicate).toBe(true)
    })

    it('counts every row the dot created, whatever became of it', () => {
      settings.setRateLimits({ ratePerMinute: 3, ratePerUtcDay: 100, timestamp: fixtureTime(1) })
      const a = submitAt(0, 10).record.dotRequestId
      const b = submitAt(1, 11).record.dotRequestId
      store.markFailed({ dotRequestId: a, failure: 'intake_refused', timestamp: fixtureTime(12) })
      store.linkSubmitted({
        dotRequestId: b,
        workbenchRequestId: 'wb-1',
        timestamp: fixtureTime(12)
      })
      store.cancel({ dotRequestId: b, timestamp: fixtureTime(13) })
      submitAt(2, 14)
      expect(errorCodeOf(() => submitAt(3, 15))).toBe('dot_rate_limited')
    })

    it('stores nothing and records no event for a refused submission', () => {
      settings.setRateLimits({ ratePerMinute: 1, ratePerUtcDay: 100, timestamp: fixtureTime(1) })
      submitAt(0, 10)
      const events = count('dot_ingress_events')
      expect(errorCodeOf(() => submitAt(1, 11))).toBe('dot_rate_limited')
      expect(count('dot_ingress_requests')).toBe(1)
      expect(count('dot_ingress_events')).toBe(events)
    })

    it('needs no per-task step: a request within the caps is received at once and ready for the door', () => {
      const result = submitAt(0, 10)
      expect(result.record.state).toBe('received')
      expect(result.intake).not.toBeNull()
    })
  })

  describe('capacity', () => {
    it('refuses the 21st request whose intake has not finished', () => {
      liftCaps()
      insertRawRequestRows(owner.db, ref, 19, 'received')
      expect(store.submit(submitInput(ref, key(300))).duplicate).toBe(false)
      expect(
        errorCodeOf(() => store.submit(submitInput(ref, { objective: 'One more.', ...key(301) })))
      ).toBe('dot_capacity_exceeded')
    })

    it('frees the slot when the intake finishes', () => {
      liftCaps()
      insertRawRequestRows(owner.db, ref, 19, 'received')
      const { record } = store.submit(submitInput(ref, key(300)))
      store.linkSubmitted({
        dotRequestId: record.dotRequestId,
        workbenchRequestId: 'wb-1',
        timestamp: fixtureTime(20)
      })
      expect(
        store.submit(submitInput(ref, { objective: 'One more.', ...key(301) })).duplicate
      ).toBe(false)
    })

    it('does not count finished requests against the waiting limit, only against retention', () => {
      liftCaps()
      insertRawRequestRows(owner.db, ref, 25, 'canceled')
      expect(store.submit(submitInput(ref, key(300))).duplicate).toBe(false)
    })

    it('refuses a submit once 10,000 requests are retained, like the Workbench store itself', () => {
      liftCaps()
      owner.db.exec('BEGIN')
      try {
        insertRawRequestRows(owner.db, ref, 10_000, 'canceled')
      } finally {
        owner.db.exec('COMMIT')
      }
      expect(errorCodeOf(() => store.submit(submitInput(ref, key(300))))).toBe(
        'dot_capacity_exceeded'
      )
      expect(count('dot_ingress_requests')).toBe(10_000)
    })
  })
})

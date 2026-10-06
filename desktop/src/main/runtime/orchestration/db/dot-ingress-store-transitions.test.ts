import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { getDotIngressSettingsStore } from './dot-ingress-settings-store'
import {
  DotIngressStore,
  getDotIngressStore,
  type DotIngressSubmitInput
} from './dot-ingress-store'
import {
  createFakeDoor,
  enableFixtureInterface,
  errorCodeOf,
  fixtureTime,
  fixtureUuid,
  requireIntake,
  submitInput
} from './dot-ingress.test-fixture'

describe('dot ingress request store: intake transitions and crash recovery', () => {
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

  const key = (n: number) => ({ idempotencyKey: fixtureUuid(n) })
  const kinds = () => settings.listEvents({ limit: 100 }).map((event) => event.kind)
  /** Lifts the per-minute and per-day caps so a test about something else is not stopped by them. */
  const liftCaps = () =>
    settings.setRateLimits({ ratePerMinute: 60, ratePerUtcDay: 10_000, timestamp: fixtureTime(1) })
  const submitAndLink = (
    overrides: Partial<DotIngressSubmitInput> = {},
    workbenchRequestId = 'wb-1'
  ) => {
    const { record } = store.submit(submitInput(ref, overrides))
    store.linkSubmitted({
      dotRequestId: record.dotRequestId,
      workbenchRequestId,
      timestamp: fixtureTime(20)
    })
    return record.dotRequestId
  }

  describe('linkSubmitted (the Workbench request exists)', () => {
    it('moves a received request to submitted and keeps the link', () => {
      const { record } = store.submit(submitInput(ref))
      const linked = store.linkSubmitted({
        dotRequestId: record.dotRequestId,
        workbenchRequestId: 'wb-1',
        timestamp: fixtureTime(20)
      })
      expect(linked.changed).toBe(true)
      expect(linked.record).toMatchObject({
        state: 'submitted',
        revision: 2,
        workbenchRequestId: 'wb-1',
        updatedAt: fixtureTime(20),
        endedAt: null
      })
      expect(kinds()[0]).toBe('request_submitted')
    })

    it('is idempotent for the same Workbench request and refuses a different one', () => {
      const id = submitAndLink()
      const again = store.linkSubmitted({
        dotRequestId: id,
        workbenchRequestId: 'wb-1',
        timestamp: fixtureTime(30)
      })
      expect(again.changed).toBe(false)
      expect(again.record.revision).toBe(2)
      expect(
        errorCodeOf(() =>
          store.linkSubmitted({
            dotRequestId: id,
            workbenchRequestId: 'wb-2',
            timestamp: fixtureTime(31)
          })
        )
      ).toBe('dot_recovery_required')
      expect(kinds().filter((kind) => kind === 'request_submitted')).toHaveLength(1)
    })

    it('refuses the Workbench request of another dot request', () => {
      liftCaps()
      submitAndLink()
      const other = store.submit(submitInput(ref, { objective: 'B.', ...key(2) })).record
        .dotRequestId
      expect(
        errorCodeOf(() =>
          store.linkSubmitted({
            dotRequestId: other,
            workbenchRequestId: 'wb-1',
            timestamp: fixtureTime(30)
          })
        )
      ).toBe('dot_recovery_required')
      expect(store.get(other).state).toBe('received')
    })

    it('refuses a failed request, an unknown request and a blank Workbench id', () => {
      const { record } = store.submit(submitInput(ref))
      store.markFailed({
        dotRequestId: record.dotRequestId,
        failure: 'workspace_unavailable',
        timestamp: fixtureTime(20)
      })
      expect(
        errorCodeOf(() =>
          store.linkSubmitted({
            dotRequestId: record.dotRequestId,
            workbenchRequestId: 'wb-1',
            timestamp: fixtureTime(21)
          })
        )
      ).toBe('dot_recovery_required')
      expect(
        errorCodeOf(() =>
          store.linkSubmitted({
            dotRequestId: fixtureUuid(99),
            workbenchRequestId: 'wb-1',
            timestamp: fixtureTime(21)
          })
        )
      ).toBe('dot_request_not_found')
      expect(
        errorCodeOf(() =>
          store.linkSubmitted({
            dotRequestId: record.dotRequestId,
            workbenchRequestId: '  ',
            timestamp: fixtureTime(21)
          })
        )
      ).toBe('dot_invalid_input')
    })
  })

  describe('markFailed (the door refused before creating a Workbench request)', () => {
    it('ends a received request as failed with a coarse code and no Workbench link', () => {
      const { record } = store.submit(submitInput(ref))
      const failed = store.markFailed({
        dotRequestId: record.dotRequestId,
        failure: 'capacity_exceeded',
        timestamp: fixtureTime(20)
      })
      expect(failed.changed).toBe(true)
      expect(failed.record).toMatchObject({
        state: 'failed',
        failureCode: 'capacity_exceeded',
        workbenchRequestId: null,
        revision: 2,
        endedAt: fixtureTime(20)
      })
      expect(kinds()[0]).toBe('request_failed')
    })

    it('is idempotent for the same code, and refuses another code, a submitted request and an unknown code', () => {
      const { record } = store.submit(submitInput(ref))
      store.markFailed({
        dotRequestId: record.dotRequestId,
        failure: 'intake_refused',
        timestamp: fixtureTime(20)
      })
      expect(
        store.markFailed({
          dotRequestId: record.dotRequestId,
          failure: 'intake_refused',
          timestamp: fixtureTime(21)
        }).changed
      ).toBe(false)
      expect(
        errorCodeOf(() =>
          store.markFailed({
            dotRequestId: record.dotRequestId,
            failure: 'capacity_exceeded',
            timestamp: fixtureTime(22)
          })
        )
      ).toBe('dot_recovery_required')
      const submitted = submitAndLink({ ...key(5), objective: 'Other.' }, 'wb-2')
      expect(
        errorCodeOf(() =>
          store.markFailed({
            dotRequestId: submitted,
            failure: 'intake_refused',
            timestamp: fixtureTime(23)
          })
        )
      ).toBe('dot_recovery_required')
      const freeText = () =>
        store.markFailed({
          dotRequestId: record.dotRequestId,
          // @ts-expect-error a free-text reason is not a coarse failure code
          failure: 'the door said no',
          timestamp: fixtureTime(24)
        })
      expect(errorCodeOf(freeText)).toBe('dot_invalid_input')
    })
  })

  describe('cancel (the service stops the Workbench request and its run first)', () => {
    it('ends a submitted request once, keeps the Workbench link and reports no change on a repeat', () => {
      const id = submitAndLink()
      const canceled = store.cancel({ dotRequestId: id, timestamp: fixtureTime(30) })
      expect(canceled.changed).toBe(true)
      expect(canceled.record).toMatchObject({
        state: 'canceled',
        revision: 3,
        workbenchRequestId: 'wb-1',
        endedAt: fixtureTime(30)
      })
      expect(store.cancel({ dotRequestId: id, timestamp: fixtureTime(40) })).toEqual({
        record: canceled.record,
        changed: false
      })
      expect(kinds().filter((kind) => kind === 'request_canceled')).toHaveLength(1)
    })

    it('refuses a received request, whose intake call is still running, and a failed one', () => {
      const received = store.submit(submitInput(ref)).record.dotRequestId
      expect(
        errorCodeOf(() => store.cancel({ dotRequestId: received, timestamp: fixtureTime(30) }))
      ).toBe('dot_request_not_cancelable')
      store.markFailed({
        dotRequestId: received,
        failure: 'intake_refused',
        timestamp: fixtureTime(31)
      })
      expect(
        errorCodeOf(() => store.cancel({ dotRequestId: received, timestamp: fixtureTime(32) }))
      ).toBe('dot_request_not_cancelable')
      expect(store.get(received).state).toBe('failed')
    })

    it('refuses an unknown request', () => {
      expect(
        errorCodeOf(() =>
          store.cancel({ dotRequestId: fixtureUuid(99), timestamp: fixtureTime(30) })
        )
      ).toBe('dot_request_not_found')
    })
  })

  describe('findByWorkbenchRequestId', () => {
    it('returns null for a Workbench request that did not come from the dot', () => {
      store.submit(submitInput(ref))
      expect(store.findByWorkbenchRequestId('wb-desktop-1')).toBeNull()
    })

    it('finds the request a Workbench request came from, also after the request was canceled', () => {
      const id = submitAndLink()
      expect(store.findByWorkbenchRequestId('wb-1')).toMatchObject({
        dotRequestId: id,
        state: 'submitted'
      })
      store.cancel({ dotRequestId: id, timestamp: fixtureTime(30) })
      expect(store.findByWorkbenchRequestId('wb-1')).toMatchObject({
        dotRequestId: id,
        state: 'canceled'
      })
    })

    it('refuses a blank id', () => {
      expect(errorCodeOf(() => store.findByWorkbenchRequestId(' '))).toBe('dot_invalid_input')
    })
  })

  describe('crash recovery: exactly one Workbench request per dot request', () => {
    it('finishes the same intake after the app stops between the door call and the link', () => {
      const door = createFakeDoor()
      const first = store.submit(submitInput(ref))
      const before = door.submit(requireIntake(first.intake))
      expect(before.duplicate).toBe(false)

      const restarted = new DotIngressStore(owner.db)
      const unfinished = restarted.listUnsubmitted(10)
      expect(unfinished.map((handle) => handle.dotRequestId)).toEqual([first.record.dotRequestId])
      const after = door.submit(requireIntake(unfinished[0]))
      expect(after).toEqual({ workbenchRequestId: before.workbenchRequestId, duplicate: true })
      restarted.linkSubmitted({
        dotRequestId: first.record.dotRequestId,
        workbenchRequestId: after.workbenchRequestId,
        timestamp: fixtureTime(40)
      })

      expect(door.requestCount).toBe(1)
      expect(restarted.listUnsubmitted(10)).toEqual([])
      expect(restarted.get(first.record.dotRequestId)).toMatchObject({
        state: 'submitted',
        workbenchRequestId: before.workbenchRequestId
      })
    })

    it('finishes the same intake when the dot retries its submit after the app stopped', () => {
      const door = createFakeDoor()
      const first = store.submit(submitInput(ref))
      door.submit(requireIntake(first.intake))
      const retry = store.submit(submitInput(ref, { timestamp: fixtureTime(50) }))
      expect(retry.duplicate).toBe(true)
      const second = door.submit(requireIntake(retry.intake))
      expect(second.duplicate).toBe(true)
      expect(door.requestCount).toBe(1)
    })

    it('hands the same Workbench key to every attempt and a different key to every request', () => {
      liftCaps()
      const a = store.submit(submitInput(ref))
      const b = store.submit(submitInput(ref, { objective: 'B.', ...key(2) }))
      const keys = store.listUnsubmitted(10).map((handle) => handle.workbenchIdempotencyKey)
      expect(keys).toEqual([a.intake?.workbenchIdempotencyKey, b.intake?.workbenchIdempotencyKey])
      expect(keys[0]).not.toBe(keys[1])
      expect(store.submit(submitInput(ref)).intake?.workbenchIdempotencyKey).toBe(keys[0])
    })

    it('lists unfinished intakes oldest first, up to the limit, and never a finished one', () => {
      liftCaps()
      const a = store.submit(submitInput(ref)).record.dotRequestId
      const b = store.submit(submitInput(ref, { objective: 'B.', ...key(2) })).record.dotRequestId
      const c = store.submit(submitInput(ref, { objective: 'C.', ...key(3) })).record.dotRequestId
      store.linkSubmitted({
        dotRequestId: c,
        workbenchRequestId: 'wb-3',
        timestamp: fixtureTime(30)
      })
      expect(store.listUnsubmitted(10).map((handle) => handle.dotRequestId)).toEqual([a, b])
      expect(store.listUnsubmitted(1).map((handle) => handle.dotRequestId)).toEqual([a])
      expect(errorCodeOf(() => store.listUnsubmitted(0))).toBe('dot_invalid_input')
    })
  })
})

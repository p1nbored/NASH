import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOT_REQUEST_STATUS_TEXT } from '../../../shared/dot-ingress/dot-ingress-status-text'
import { DotRemoteEventBatchSchema } from '../../../shared/dot-remote/dot-remote-events'
import { requestId } from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createDotRemoteOutboxFlush } from './dot-remote-outbox-flush'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import { getDotRemoteRequestStore } from './dot-remote-request-store'
import { ensureDotRemoteSchema } from './dot-remote-schema'
import { fixtureClock, fixtureCredentials, scriptedSite, siteOk } from './dot-remote.test-fixture'

const eventId = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('dot remote outbox flush', () => {
  let owner: OrchestrationDb
  let clock: ReturnType<typeof fixtureClock>
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ensureDotRemoteSchema(owner.db)
    getDotRemoteRequestStore(owner).track({
      dotRequestId: requestId(1),
      submitItemId: '10000000-0000-4000-8000-000000000001',
      generation: 1,
      timestamp: '2026-10-05T12:00:00.000Z'
    })
    clock = fixtureClock(10)
  })
  afterEach(() => owner.close())

  function record(count: number): void {
    const outbox = getDotRemoteOutboxStore(owner)
    for (let n = 1; n <= count; n += 1) {
      outbox.enqueue({
        dotRequestId: requestId(1),
        facet: `f${n}`,
        signature: n.toString(16).padStart(64, '0'),
        timestamp: '2026-10-05T12:00:01.000Z',
        build: (revision) => ({
          eventId: eventId(n),
          kind: 'request_status',
          dotRequestId: requestId(1),
          sourceRevision: revision,
          at: '2026-10-05T12:00:01.000Z',
          data: {
            state: 'received',
            statusText: DOT_REQUEST_STATUS_TEXT.received,
            run: { state: 'not_started', blocker: null }
          }
        })
      })
    }
  }

  const binding = () => ({ credentials: fixtureCredentials(), generation: 1 })

  function applyAll(body: unknown) {
    const batch = DotRemoteEventBatchSchema.parse(body)
    const results = batch.events.map((event) => ({ eventId: event.eventId, status: 'applied' }))
    const last = batch.events.at(-1)?.sourceRevision ?? 0
    return siteOk({ results, cursors: [{ dotRequestId: requestId(1), appliedRevision: last }] })
  }

  function flusherWith(site: ReturnType<typeof scriptedSite>) {
    return createDotRemoteOutboxFlush({ owner, site: site.client, now: clock.now, log: vi.fn() })
  }

  it('sends nothing while nothing is pending', async () => {
    const site = scriptedSite({})
    expect(await flusherWith(site).flush(binding())).toEqual({ kind: 'idle' })
    expect(site.calls).toEqual([])
  })

  it('sends pending events in revision order, in batches of at most 50', async () => {
    record(60)
    const site = scriptedSite({ 'events.post': applyAll })
    expect(await flusherWith(site).flush(binding())).toEqual({ kind: 'sent', events: 60 })
    expect(
      site.calls.map((call) => DotRemoteEventBatchSchema.parse(call.body).events.length)
    ).toEqual([50, 10])
    const first = DotRemoteEventBatchSchema.parse(site.calls[0]?.body)
    expect(first.generation).toBe(1)
    expect(first.events.map((event) => event.sourceRevision)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1)
    )
    expect(getDotRemoteOutboxStore(owner).countPending()).toBe(0)
  })

  it('settles duplicates and stale events, and rejects conflicts and unknown requests for good', async () => {
    record(4)
    const statuses = ['duplicate', 'stale', 'conflict', 'unknown_request']
    const site = scriptedSite({
      'events.post': (body) => {
        const batch = DotRemoteEventBatchSchema.parse(body)
        return siteOk({
          results: batch.events.map((event, index) => ({
            eventId: event.eventId,
            status: statuses[index]
          })),
          cursors: [{ dotRequestId: requestId(1), appliedRevision: 4 }]
        })
      }
    })
    await flusherWith(site).flush(binding())
    expect(getDotRemoteOutboxStore(owner).countPending()).toBe(0)
    expect(await flusherWith(site).flush(binding())).toEqual({ kind: 'idle' })
  })

  it('sends again what the Site no longer holds after a restore, from its cursor', async () => {
    record(3)
    let restored = false
    const site = scriptedSite({
      'events.post': (body) => {
        const batch = DotRemoteEventBatchSchema.parse(body)
        const results = batch.events.map((event) => ({ eventId: event.eventId, status: 'applied' }))
        const applied = restored ? 3 : 1
        restored = true
        return siteOk({
          results,
          cursors: [{ dotRequestId: requestId(1), appliedRevision: applied }]
        })
      }
    })
    const flusher = flusherWith(site)
    await flusher.flush(binding())
    expect(getDotRemoteOutboxStore(owner).countPending()).toBe(2)
    await flusher.flush(binding())
    expect(
      DotRemoteEventBatchSchema.parse(site.calls[1]?.body).events.map((e) => e.eventId)
    ).toEqual([eventId(2), eventId(3)])
    expect(getDotRemoteOutboxStore(owner).countPending()).toBe(0)
  })

  it('backs off after a failed send and keeps every event pending', async () => {
    record(2)
    const site = scriptedSite({
      'events.post': () => ({ ok: false, kind: 'unavailable', reason: 'network' })
    })
    const flusher = flusherWith(site)
    expect(await flusher.flush(binding())).toEqual({
      kind: 'failure',
      failure: { kind: 'unavailable', reason: 'network' }
    })
    expect(await flusher.flush(binding())).toEqual({ kind: 'backoff' })
    expect(site.calls).toHaveLength(1)
    clock.advance(5_000)
    await flusher.flush(binding())
    expect(site.calls).toHaveLength(2)
    expect(getDotRemoteOutboxStore(owner).countPending()).toBe(2)
  })

  it('does not back off after a send the agent aborted itself (switch off or quit)', async () => {
    record(2)
    let aborted = true
    const site = scriptedSite({
      'events.post': (body) =>
        aborted ? { ok: false, kind: 'unavailable', reason: 'aborted' } : applyAll(body)
    })
    const flusher = flusherWith(site)
    expect(await flusher.flush(binding())).toEqual({
      kind: 'failure',
      failure: { kind: 'unavailable', reason: 'aborted' }
    })
    aborted = false
    expect(await flusher.flush(binding())).toEqual({ kind: 'sent', events: 2 })
    expect(site.calls).toHaveLength(2)
  })

  it('neither grows nor resets the backoff of real failures on an aborted send', async () => {
    record(1)
    const network = { ok: false, kind: 'unavailable', reason: 'network' } as const
    const aborted = { ok: false, kind: 'unavailable', reason: 'aborted' } as const
    const answers = [network, aborted, network]
    const site = scriptedSite({ 'events.post': () => answers.shift() ?? network })
    const flusher = flusherWith(site)
    await flusher.flush(binding())
    clock.advance(5_000)
    await flusher.flush(binding())
    await flusher.flush(binding())
    expect(site.calls).toHaveLength(3)
    clock.advance(5_000)
    // Why still waiting: the second real failure doubles the wait to 10 s.
    expect(await flusher.flush(binding())).toEqual({ kind: 'backoff' })
  })

  it('returns a revoked generation for the agent to fence', async () => {
    record(1)
    const site = scriptedSite({
      'events.post': () => ({ ok: false, kind: 'site_error', code: 'generation_revoked' })
    })
    expect(await flusherWith(site).flush(binding())).toEqual({
      kind: 'failure',
      failure: { kind: 'site_error', code: 'generation_revoked' }
    })
  })

  it('sends only the events of the live generation', async () => {
    record(1)
    const site = scriptedSite({ 'events.post': applyAll })
    expect(await flusherWith(site).flush({ ...binding(), generation: 2 })).toEqual({ kind: 'idle' })
  })
})

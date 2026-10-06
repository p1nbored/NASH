import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOT_REQUEST_STATUS_TEXT } from '../../../shared/dot-ingress/dot-ingress-status-text'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getDotRemoteArtifactRefs } from './dot-remote-artifact-refs'
import { getDotRemoteItemJournal } from './dot-remote-item-journal'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import { getDotRemoteRequestStore } from './dot-remote-request-store'
import { ensureDotRemoteSchema } from './dot-remote-schema'
import { getDotRemoteSettingsStore } from './dot-remote-settings-store'

// FIXTURE_ONLY: synthetic ids and an obviously fake origin.
const ORIGIN = 'https://fixture-nash.example.test'
const DEVICE = 'dev_0123456789abcdef01234567'
const T0 = '2026-10-05T12:00:00.000Z'
const T1 = '2026-10-05T12:00:05.000Z'
const LIFETIME_END = '2026-11-04T12:00:00.000Z'
const LATER = '2026-10-20T12:00:00.000Z'
const id = (prefix: number, n: number) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const REQUEST = id(3, 1)
const OTHER_REQUEST = id(3, 2)
const SUBMIT_ITEM = id(1, 1)

function statusEvent(revision: number, eventId: string) {
  return {
    eventId,
    kind: 'request_status' as const,
    dotRequestId: REQUEST,
    sourceRevision: revision,
    at: T0,
    data: {
      state: 'received' as const,
      statusText: DOT_REQUEST_STATUS_TEXT.received,
      run: { state: 'not_started' as const, blocker: null }
    }
  }
}

describe('dot remote stores', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ensureDotRemoteSchema(owner.db)
  })
  afterEach(() => owner.close())

  it('keeps the remote switch off and the origin unset by default', () => {
    expect(getDotRemoteSettingsStore(owner).getSettings()).toEqual({
      enabled: false,
      origin: null,
      lastSyncAt: null,
      updatedAt: null
    })
  })

  it('persists the switch, the origin and the last sync time', () => {
    const settings = getDotRemoteSettingsStore(owner)
    settings.setEnabled(true, T0)
    settings.setOrigin(ORIGIN, T0)
    settings.recordSync(T1)
    expect(settings.getSettings()).toEqual({
      enabled: true,
      origin: ORIGIN,
      lastSyncAt: T1,
      updatedAt: T1
    })
  })

  it('refuses a non-https origin at the database', () => {
    expect(() => getDotRemoteSettingsStore(owner).setOrigin('http://fixture.test', T0)).toThrow()
  })

  it('records one pairing and fences it by generation on revoke', () => {
    const settings = getDotRemoteSettingsStore(owner)
    settings.recordPairing({
      origin: ORIGIN,
      deviceId: DEVICE,
      generation: 3,
      lifetimeEndsAt: LIFETIME_END,
      timestamp: T0
    })
    expect(settings.markRevoked(2, T1)).toBe(false)
    expect(settings.getPairing()?.revokedAt).toBeNull()
    expect(settings.markRevoked(3, T1)).toBe(true)
    expect(settings.getPairing()).toEqual({
      origin: ORIGIN,
      deviceId: DEVICE,
      generation: 3,
      pairedAt: T0,
      lifetimeEndsAt: LIFETIME_END,
      revokedAt: T1
    })
  })

  it('keeps the pairing lifetime the Site granted, and refuses a malformed one', () => {
    const settings = getDotRemoteSettingsStore(owner)
    const pairing = { origin: ORIGIN, deviceId: DEVICE, generation: 1, timestamp: T0 }
    settings.recordPairing({ ...pairing, lifetimeEndsAt: LIFETIME_END })
    expect(settings.getPairing()?.lifetimeEndsAt).toBe(LIFETIME_END)
    expect(() => settings.recordPairing({ ...pairing, lifetimeEndsAt: 'tomorrow' })).toThrow()
    expect(settings.getPairing()?.lifetimeEndsAt).toBe(LIFETIME_END)
  })

  it('tracks a request once and lists it while open', () => {
    const requests = getDotRemoteRequestStore(owner)
    requests.track({
      dotRequestId: REQUEST,
      submitItemId: SUBMIT_ITEM,
      generation: 1,
      timestamp: T0
    })
    requests.track({
      dotRequestId: REQUEST,
      submitItemId: SUBMIT_ITEM,
      generation: 1,
      timestamp: T1
    })
    expect(requests.listOpen(10)).toEqual([
      { dotRequestId: REQUEST, submitItemId: SUBMIT_ITEM, generation: 1, lastRevision: 0 }
    ])
    requests.close(REQUEST, T1)
    expect(requests.listOpen(10)).toEqual([])
  })

  it('persists an event with the next source revision and its facet signature in one step', () => {
    getDotRemoteRequestStore(owner).track({
      dotRequestId: REQUEST,
      submitItemId: SUBMIT_ITEM,
      generation: 1,
      timestamp: T0
    })
    const outbox = getDotRemoteOutboxStore(owner)
    const first = outbox.enqueue({
      dotRequestId: REQUEST,
      facet: 'status',
      signature: 'a'.repeat(64),
      timestamp: T0,
      build: (revision) => statusEvent(revision, id(6, 1))
    })
    const second = outbox.enqueue({
      dotRequestId: REQUEST,
      facet: 'status',
      signature: 'b'.repeat(64),
      timestamp: T1,
      build: (revision) => statusEvent(revision, id(6, 2))
    })
    expect([first?.sourceRevision, second?.sourceRevision]).toEqual([1, 2])
    expect(getDotRemoteRequestStore(owner).facetSignature(REQUEST, 'status')).toBe('b'.repeat(64))
    expect(outbox.pending(1, 50).map((event) => event.sourceRevision)).toEqual([1, 2])
    expect(outbox.countPending()).toBe(2)
  })

  it('skips an unchanged facet without allocating a revision', () => {
    getDotRemoteRequestStore(owner).track({
      dotRequestId: REQUEST,
      submitItemId: SUBMIT_ITEM,
      generation: 1,
      timestamp: T0
    })
    const outbox = getDotRemoteOutboxStore(owner)
    const input = {
      dotRequestId: REQUEST,
      facet: 'status',
      signature: 'a'.repeat(64),
      timestamp: T0,
      build: (revision: number) => statusEvent(revision, id(6, revision))
    }
    outbox.enqueue(input)
    expect(outbox.enqueue(input)).toBeNull()
    expect(outbox.countPending()).toBe(1)
  })

  it('marks results, requeues above a cursor and fences a revoked generation', () => {
    const requests = getDotRemoteRequestStore(owner)
    requests.track({
      dotRequestId: REQUEST,
      submitItemId: SUBMIT_ITEM,
      generation: 1,
      timestamp: T0
    })
    requests.track({
      dotRequestId: OTHER_REQUEST,
      submitItemId: id(1, 2),
      generation: 2,
      timestamp: T0
    })
    const outbox = getDotRemoteOutboxStore(owner)
    for (const n of [1, 2, 3]) {
      outbox.enqueue({
        dotRequestId: REQUEST,
        facet: `f${n}`,
        signature: String(n).repeat(64),
        timestamp: T0,
        build: (revision) => statusEvent(revision, id(6, n))
      })
    }
    outbox.markResults(
      [
        { eventId: id(6, 1), status: 'applied' },
        { eventId: id(6, 2), status: 'stale' },
        { eventId: id(6, 3), status: 'applied' }
      ],
      T1
    )
    expect(outbox.countPending()).toBe(0)
    expect(outbox.requeueAbove(REQUEST, 1, T1)).toBe(1)
    expect(outbox.pending(1, 50).map((event) => event.eventId)).toEqual([id(6, 3)])
    expect(outbox.fenceGeneration(1, T1)).toBe(1)
    expect(outbox.pending(1, 50)).toEqual([])
  })

  it('purges settled events and journal rows past the retention horizon only', () => {
    getDotRemoteRequestStore(owner).track({
      dotRequestId: REQUEST,
      submitItemId: SUBMIT_ITEM,
      generation: 1,
      timestamp: T0
    })
    const outbox = getDotRemoteOutboxStore(owner)
    outbox.enqueue({
      dotRequestId: REQUEST,
      facet: 'status',
      signature: 'a'.repeat(64),
      timestamp: T0,
      build: (revision) => statusEvent(revision, id(6, 1))
    })
    outbox.markResults([{ eventId: id(6, 1), status: 'applied' }], T0)
    getDotRemoteItemJournal(owner).record({
      itemId: SUBMIT_ITEM,
      kind: 'submit',
      payloadSha256: 'c'.repeat(64),
      generation: 1,
      outcome: { outcome: 'accepted', dotRequestId: REQUEST },
      dotRequestId: REQUEST,
      timestamp: T0
    })
    expect(outbox.purgeSettledBefore(T0, 100)).toBe(0)
    expect(outbox.purgeSettledBefore(LATER, 100)).toBe(1)
    expect(getDotRemoteItemJournal(owner).purgeBefore(LATER, 100)).toBe(1)
  })

  it('journals an item outcome before its ack and marks the ack', () => {
    const journal = getDotRemoteItemJournal(owner)
    journal.record({
      itemId: SUBMIT_ITEM,
      kind: 'submit',
      payloadSha256: 'c'.repeat(64),
      generation: 1,
      outcome: { outcome: 'accepted', dotRequestId: REQUEST },
      dotRequestId: REQUEST,
      timestamp: T0
    })
    expect(journal.get(SUBMIT_ITEM)).toMatchObject({
      payloadSha256: 'c'.repeat(64),
      outcome: { outcome: 'accepted', dotRequestId: REQUEST },
      acked: false
    })
    journal.markAcked(SUBMIT_ITEM, T1)
    expect(journal.get(SUBMIT_ITEM)?.acked).toBe(true)
    expect(journal.requestOfItem(SUBMIT_ITEM)).toBe(REQUEST)
  })

  it('maps an artifact to one stable opaque id that holds no path', () => {
    const refs = getDotRemoteArtifactRefs(owner)
    const first = refs.refFor('artifact_fixture_1', T0)
    expect(first).toMatch(/^art_[0-9a-f]{24}$/)
    expect(refs.refFor('artifact_fixture_1', T1)).toBe(first)
    expect(refs.refFor('artifact_fixture_2', T1)).not.toBe(first)
  })
})

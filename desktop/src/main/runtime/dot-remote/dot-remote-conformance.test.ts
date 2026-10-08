// FIXTURE_ONLY: R2's conformance vectors replayed against the agent's own components (consumer,
// outbox flush, presence, session) over the real Site client and the replaying fake Site. The
// pairing and refresh vectors drive the whole agent in dot-remote-conformance-pairing.test.ts.
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { DEVICE } from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import type { DotRemoteEndpointStep } from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { buildDotRemoteConformanceVectors } from '../../../shared/dot-remote/dot-remote-vectors.test-fixture'
import type { DotRemoteVector } from '../../../shared/dot-remote/dot-remote-vectors.test-fixture'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createDotRemoteSessionHolder } from './dot-remote-agent-session'
import { createDotRemoteConsumer, type DotRemoteAckedItem } from './dot-remote-consumer'
import { failureAction } from './dot-remote-failure'
import { getDotRemoteItemJournal } from './dot-remote-item-journal'
import { createDotRemoteOutboxFlush } from './dot-remote-outbox-flush'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import { createDotRemotePresence, type DotRemoteWorkspaceEntry } from './dot-remote-presence'
import { getDotRemoteRequestStore } from './dot-remote-request-store'
import { ensureDotRemoteSchema } from './dot-remote-schema'
import { createDotRemoteSiteClient, type DotRemoteSiteFailure } from './dot-remote-site-client'
import {
  createVectorReplay,
  isPairingVector,
  ownSteps
} from './dot-remote-vector-replay.test-fixture'
import {
  FIXTURE_ORIGIN,
  FIXTURE_SERVICE_VALUE,
  FIXTURE_SESSION_VALUE,
  memoryCredentials
} from './dot-remote.test-fixture'

const NASH_SIDE_SKIPS = new Set([
  // One consumer never polls while it holds leased items; the vector's extra poll is the Site's case.
  'poll_while_holding_items',
  // NASH never sends an event twice; the vector's replayed batch tests the Site's fold.
  'resend_of_sent_events',
  // After it revokes, NASH fences the generation and makes no further call of it.
  'fenced_after_revocation'
])

const VECTORS: [string, DotRemoteVector][] = buildDotRemoteConformanceVectors()
  .vectors.filter((vector) => ownSteps(vector).length > 0 && !isPairingVector(vector))
  .map((vector) => [vector.id, vector])

const FIXTURE_DEVICE_CREDENTIAL =
  'ndc_0123456789abcdef01234567.FIXTUREdeviceCredentialSecret00000000000000000001'
const NO_TIMERS = { schedule: () => ({ cancel: () => undefined }) }
const owners: OrchestrationDb[] = []
afterEach(() => owners.splice(0).forEach((owner) => owner.close()))

function isEventBatch(
  body: Record<string, unknown>
): body is { events: Record<string, unknown>[] } {
  return Array.isArray(body.events)
}

function workspacesOf(step: DotRemoteEndpointStep): DotRemoteWorkspaceEntry[] {
  return Array.isArray(step.body.workspaces) ? step.body.workspaces : []
}

async function replayAgainstAgent(vector: DotRemoteVector) {
  const owner = new OrchestrationDb(':memory:')
  owners.push(owner)
  ensureDotRemoteSchema(owner.db)
  const replay = createVectorReplay(vector)
  const iso = () => new Date(replay.now()).toISOString()
  const site = createDotRemoteSiteClient({ origin: FIXTURE_ORIGIN, fetch: replay.fetch })
  const credentials = memoryCredentials()
  credentials.save(FIXTURE_SERVICE_VALUE)
  const sessions = createDotRemoteSessionHolder({ owner, credentials, site, now: replay.now })
  const farAhead = '2026-10-06T12:00:00.000Z'
  const issued = { sessionToken: FIXTURE_SESSION_VALUE, expiresAt: farAhead, renewAfter: farAhead }
  const grant = { credential: FIXTURE_DEVICE_CREDENTIAL, expiresAt: '2026-11-04T12:00:00.000Z' }
  sessions.install({ ...issued, deviceId: DEVICE, generation: 1 }, grant, FIXTURE_ORIGIN)
  const requests = getDotRemoteRequestStore(owner)
  const outbox = getDotRemoteOutboxStore(owner)
  // Why the agent's own rule: an admitted submit starts tracking its request for events.
  const onAcked = ({ item, outcome }: DotRemoteAckedItem) => {
    if (
      item.kind === 'submit' &&
      (outcome.outcome === 'accepted' || outcome.outcome === 'duplicate')
    ) {
      requests.track({
        dotRequestId: outcome.dotRequestId,
        submitItemId: item.itemId,
        generation: 1,
        timestamp: iso()
      })
    }
  }
  const consumer = createDotRemoteConsumer({
    site,
    endpoint: replay.endpoint,
    journal: getDotRemoteItemJournal(owner),
    now: replay.now,
    timers: NO_TIMERS,
    log: () => undefined,
    isCurrent: (generation) => generation === 1,
    onAcked
  })
  const flush = createDotRemoteOutboxFlush({ owner, site, now: replay.now, log: () => undefined })
  let workspaces: DotRemoteWorkspaceEntry[] = []
  const presence = createDotRemotePresence({
    now: replay.now,
    appVersion: '1.4.0',
    listWorkspaces: () => workspaces
  })
  const failures: { step: DotRemoteEndpointStep; failure: DotRemoteSiteFailure }[] = []
  const sentEventIds = new Set<string>()

  for (let step = replay.next(); step !== null; step = replay.next()) {
    const before = replay.position()
    const binding = sessions.binding()
    if (!binding) {
      replay.skip('fenced_after_revocation')
      continue
    }
    if (step.endpoint === 'inbox.lease') {
      const result = await consumer.run(binding)
      if (result.kind === 'failure') {
        failures.push({ step, failure: result.failure })
      }
    } else if (step.endpoint === 'events.post' && isEventBatch(step.body)) {
      const events = step.body.events
      if (events.some((event) => sentEventIds.has(String(event.eventId)))) {
        replay.skip('resend_of_sent_events')
        continue
      }
      for (const event of events) {
        sentEventIds.add(String(event.eventId))
        outbox.enqueue({
          dotRequestId: String(event.dotRequestId),
          facet: `vector:${String(event.eventId)}`,
          signature: createHash('sha256').update(String(event.eventId)).digest('hex'),
          timestamp: iso(),
          build: (sourceRevision) => ({ ...event, sourceRevision })
        })
      }
      const result = await flush.flush(binding)
      if (result.kind === 'failure') {
        failures.push({ step, failure: result.failure })
      }
    } else if (step.endpoint === 'heartbeat.post' || step.endpoint === 'workspaces.put') {
      workspaces = workspacesOf(step)
      await presence.sync(site, binding)
    } else if (step.endpoint === 'pairing.revoke') {
      // Why both: the agent's revoke tells the Site, then fences the generation on the PC at once.
      await sessions.revokeOnSite()
      sessions.fence(null)
    }
    if (replay.position() === before) {
      replay.skip('not_reached')
    }
  }
  return { replay, failures, sessions, outbox }
}

describe("R2's conformance vectors, NASH side", () => {
  it.each(VECTORS)(
    '%s: NASH makes every scripted call with the exact body',
    async (_id, vector) => {
      const { replay } = await replayAgainstAgent(vector)
      expect(replay.skipped.filter((skip) => !NASH_SIDE_SKIPS.has(skip.reason))).toEqual([])
      expect(replay.matched.length).toBeGreaterThan(0)
      for (const match of replay.matched) {
        expect({ endpoint: match.step.endpoint, body: match.sent }).toEqual({
          endpoint: match.step.endpoint,
          body: match.step.body
        })
        expect(match.pathItemId).toBe(match.step.itemId ?? null)
        expect(match.headers).toEqual({ service: true, session: true, device: null })
      }
    }
  )

  it.each(VECTORS)('%s: NASH acts on each Site error the vector expects', async (_id, vector) => {
    const { failures } = await replayAgainstAgent(vector)
    for (const { step, failure } of failures) {
      const expected = 'error' in step.expect ? step.expect.error.code : null
      if (expected === null) {
        // Why: a call past the vector's script is answered 503 and is only retried later.
        expect(failureAction(failure)).toEqual({ action: 'retry' })
        continue
      }
      expect(failure).toEqual({ kind: 'site_error', code: expected })
      expect(failureAction(failure).action).not.toBe('retry')
    }
  })

  it('stops at once after revoking: nothing of the generation is sent afterwards', async () => {
    const revoked = VECTORS.find(([id]) => id === 'error.revoked_generation')?.[1]
    expect(revoked).toBeDefined()
    const { replay, sessions } = await replayAgainstAgent(revoked ?? VECTORS[0][1])
    expect(replay.skipped.map((skip) => `${skip.step.endpoint}:${skip.reason}`)).toEqual([
      'inbox.lease:fenced_after_revocation',
      'events.post:fenced_after_revocation'
    ])
    expect(sessions.binding()).toBeNull()
    expect(replay.unscripted).toEqual([])
  })

  it('runs every NASH step of this device, skipping only the Site-side cases', async () => {
    const skipped: string[] = []
    let matched = 0
    for (const [id, vector] of VECTORS) {
      const { replay } = await replayAgainstAgent(vector)
      matched += replay.matched.length
      skipped.push(...replay.skipped.map((skip) => `${id} ${skip.step.endpoint} ${skip.reason}`))
    }
    expect(skipped).toEqual([
      'race.duplicate_and_late_events events.post resend_of_sent_events',
      'race.cancel_after_claim inbox.lease poll_while_holding_items',
      'error.revoked_generation inbox.lease fenced_after_revocation',
      'error.revoked_generation events.post fenced_after_revocation'
    ])
    // Why 96: the vectors hold 100 steps of this device; the four above are the Site's cases.
    expect(matched).toBe(96)
  })
})

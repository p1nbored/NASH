import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DOT_REQUEST_STATUS_TEXT } from '../../../shared/dot-ingress/dot-ingress-status-text'
import { DotRemoteAckRequestSchema } from '../../../shared/dot-remote/dot-remote-ack'
import { dotRemoteError, dotRemoteNashRefusal } from '../../../shared/dot-remote/dot-remote-errors'
import { DotRemoteLeaseRenewRequestSchema } from '../../../shared/dot-remote/dot-remote-inbox'
import { dotRemotePayloadSha256 } from '../../../shared/dot-remote/dot-remote-payload'
import {
  at,
  decisionId,
  decisionView,
  itemId,
  leased,
  messageId,
  nonce,
  payloadOf,
  requestId,
  submitArgs
} from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createDotRemoteConsumer, type DotRemoteAckedItem } from './dot-remote-consumer'
import { getDotRemoteItemJournal } from './dot-remote-item-journal'
import { ensureDotRemoteSchema } from './dot-remote-schema'
import type { DotRemoteLog } from './dot-remote-timers'
import {
  fakeLocalEndpoint,
  fixtureClock,
  fixtureCredentials,
  manualTimers,
  scriptedSite,
  siteOk
} from './dot-remote.test-fixture'

const SUBMIT = payloadOf('submit', submitArgs(1))

function requestView(n: number) {
  return {
    contractVersion: 3,
    dotRequestId: requestId(n),
    sequence: n,
    revision: 1,
    workspaceRef: 'dws_0123456789abcdef01234567',
    deliverableLanguage: null,
    reply: null,
    createdAt: at(1),
    updatedAt: at(1),
    result: null,
    artifacts: [],
    state: 'submitted',
    statusText: DOT_REQUEST_STATUS_TEXT.submitted,
    run: { state: 'active', blocker: null },
    requestedAccess: 'read_only'
  }
}

const submitted = (duplicate = false) => ({
  ok: true as const,
  result: { contractVersion: 3, request: requestView(1), duplicate }
})
const refused = (code: string) => ({ ok: false as const, kind: 'refused' as const, code })

function ackResponse(body: unknown) {
  const ack = DotRemoteAckRequestSchema.parse(body)
  return siteOk({ itemId: ack.itemId, recorded: 'applied', receiptState: 'accepted' })
}

describe('dot remote consumer', () => {
  let owner: OrchestrationDb
  let clock: ReturnType<typeof fixtureClock>
  let timers: ReturnType<typeof manualTimers>
  let acked: DotRemoteAckedItem[]
  let current: boolean
  let log: Mock<DotRemoteLog>
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ensureDotRemoteSchema(owner.db)
    clock = fixtureClock(2)
    timers = manualTimers(clock)
    acked = []
    current = true
    log = vi.fn<DotRemoteLog>()
  })
  afterEach(() => owner.close())

  function consumerWith(
    site: ReturnType<typeof scriptedSite>,
    local: ReturnType<typeof fakeLocalEndpoint>
  ) {
    return createDotRemoteConsumer({
      site: site.client,
      endpoint: local.endpoint,
      journal: getDotRemoteItemJournal(owner),
      now: clock.now,
      timers: timers.timers,
      log,
      isCurrent: (generation) => current && generation === 1,
      onAcked: (item) => acked.push(item)
    })
  }

  const binding = () => ({ credentials: fixtureCredentials(), generation: 1 })

  function leaseOf(items: unknown[]) {
    return () => siteOk({ generation: 1, serverTime: at(1), items })
  }

  it('dispatches a leased submit as received and acks the request NASH created', async () => {
    const item = leased({
      item: 1,
      kind: 'submit',
      payload: SUBMIT,
      created: 0,
      leased: 1,
      nonce: 1
    })
    const site = scriptedSite({ 'inbox.lease': leaseOf([item]), 'inbox.ack': ackResponse })
    const local = fakeLocalEndpoint({ 'dotIngress.requests.submit': () => submitted() })
    const result = await consumerWith(site, local).run(binding())
    expect(result).toEqual({ kind: 'done', items: 1 })
    expect(site.calls[0]).toEqual({ name: 'inbox.lease', body: { generation: 1, maxItems: 10 } })
    expect(local.calls[0]?.params).toEqual(SUBMIT)
    expect(local.calls[0]?.params.idempotencyKey).toBe(SUBMIT.idempotencyKey)
    expect(site.calls[1]).toEqual({
      name: 'inbox.ack',
      itemId: itemId(1),
      body: {
        itemId: itemId(1),
        leaseNonce: nonce(1),
        generation: 1,
        payloadSha256: dotRemotePayloadSha256(SUBMIT),
        ackedAt: at(2),
        outcome: 'accepted',
        dotRequestId: requestId(1)
      }
    })
    expect(getDotRemoteItemJournal(owner).get(itemId(1))?.acked).toBe(true)
    expect(acked).toEqual([
      {
        item: { itemId: itemId(1), kind: 'submit', dependsOnItemId: null },
        outcome: { outcome: 'accepted', dotRequestId: requestId(1) },
        messageOutcome: null
      }
    ])
  })

  it('acks a submit NASH had already admitted as a duplicate', async () => {
    const item = leased({
      item: 1,
      kind: 'submit',
      payload: SUBMIT,
      created: 0,
      leased: 1,
      nonce: 1
    })
    const site = scriptedSite({ 'inbox.lease': leaseOf([item]), 'inbox.ack': ackResponse })
    const local = fakeLocalEndpoint({ 'dotIngress.requests.submit': () => submitted(true) })
    await consumerWith(site, local).run(binding())
    expect(site.calls[1]?.body).toMatchObject({ outcome: 'duplicate', dotRequestId: requestId(1) })
  })

  it('acks a NASH refusal with its fixed English message', async () => {
    const item = leased({
      item: 1,
      kind: 'submit',
      payload: SUBMIT,
      created: 0,
      leased: 1,
      nonce: 1
    })
    const site = scriptedSite({ 'inbox.lease': leaseOf([item]), 'inbox.ack': ackResponse })
    const local = fakeLocalEndpoint({
      'dotIngress.requests.submit': () => refused('dot_workspace_unknown')
    })
    await consumerWith(site, local).run(binding())
    expect(site.calls[1]?.body).toMatchObject({
      outcome: 'refused',
      dotRequestId: null,
      refusal: dotRemoteNashRefusal('dot_workspace_unknown')
    })
    expect(acked[0]?.outcome.outcome).toBe('refused')
  })

  it('acks an expired item without dispatching it', async () => {
    const item = leased({
      item: 1,
      kind: 'submit',
      payload: SUBMIT,
      created: 0,
      leased: 1,
      nonce: 1,
      expires: 1
    })
    const site = scriptedSite({ 'inbox.lease': leaseOf([item]), 'inbox.ack': ackResponse })
    const local = fakeLocalEndpoint({ 'dotIngress.requests.submit': () => submitted() })
    await consumerWith(site, local).run(binding())
    expect(local.calls).toEqual([])
    expect(site.calls[1]?.body).toEqual({
      itemId: itemId(1),
      leaseNonce: nonce(1),
      generation: 1,
      payloadSha256: dotRemotePayloadSha256(SUBMIT),
      ackedAt: at(2),
      outcome: 'expired'
    })
  })

  describe('a remote write request (D-034)', () => {
    const WRITE = payloadOf('submit', submitArgs(1, { requestedAccess: 'workspace_write' }))
    const writeItem = () =>
      leased({ item: 1, kind: 'submit', payload: WRITE, created: 0, leased: 1, nonce: 1 })

    it('reaches the dot endpoint unchanged and is accepted where the workspace allows writing', async () => {
      const site = scriptedSite({ 'inbox.lease': leaseOf([writeItem()]), 'inbox.ack': ackResponse })
      const local = fakeLocalEndpoint({ 'dotIngress.requests.submit': () => submitted() })
      await consumerWith(site, local).run(binding())
      expect(local.calls.map((call) => call.params)).toEqual([WRITE])
      expect(site.calls[1]?.body).toMatchObject({
        outcome: 'accepted',
        dotRequestId: requestId(1)
      })
    })

    it('is refused with the endpoint code where the workspace maximum is read only', async () => {
      const site = scriptedSite({ 'inbox.lease': leaseOf([writeItem()]), 'inbox.ack': ackResponse })
      const local = fakeLocalEndpoint({
        'dotIngress.requests.submit': () => refused('dot_access_above_maximum')
      })
      await consumerWith(site, local).run(binding())
      expect(local.calls).toHaveLength(1)
      expect(site.calls[1]?.body).toMatchObject({
        outcome: 'refused',
        dotRequestId: null,
        refusal: dotRemoteNashRefusal('dot_access_above_maximum')
      })
    })
  })

  it('answers a re-leased item from the journal with the new lease nonce, never dispatching twice', async () => {
    const first = leased({
      item: 1,
      kind: 'submit',
      payload: SUBMIT,
      created: 0,
      leased: 1,
      nonce: 1
    })
    const again = leased({
      item: 1,
      kind: 'submit',
      payload: SUBMIT,
      created: 0,
      leased: 70,
      nonce: 2
    })
    let lease = 0
    const site = scriptedSite({
      'inbox.lease': () =>
        siteOk({ generation: 1, serverTime: at(1), items: [lease++ === 0 ? first : again] }),
      'inbox.ack': (body) =>
        lease === 1 ? { ok: false, kind: 'site_error', code: 'lease_lost' } : ackResponse(body)
    })
    const local = fakeLocalEndpoint({ 'dotIngress.requests.submit': () => submitted() })
    const consumer = consumerWith(site, local)
    await consumer.run(binding())
    expect(acked).toEqual([])
    await consumer.run(binding())
    expect(local.calls).toHaveLength(1)
    expect(site.calls.filter((call) => call.name === 'inbox.ack').map((call) => call.body)).toEqual(
      [
        expect.objectContaining({ leaseNonce: nonce(1), outcome: 'accepted' }),
        expect.objectContaining({ leaseNonce: nonce(2), outcome: 'accepted' })
      ]
    )
    expect(acked).toHaveLength(1)
  })

  it('skips an item leased under another generation without acking it', async () => {
    const item = leased({
      item: 1,
      kind: 'submit',
      payload: SUBMIT,
      created: 0,
      leased: 1,
      nonce: 1
    })
    const stale: unknown = JSON.parse(
      JSON.stringify(item).replace('"generation":1', '"generation":2')
    )
    const site = scriptedSite({ 'inbox.lease': leaseOf([stale]), 'inbox.ack': ackResponse })
    const local = fakeLocalEndpoint({ 'dotIngress.requests.submit': () => submitted() })
    await consumerWith(site, local).run(binding())
    expect(local.calls).toEqual([])
    expect(site.calls.map((call) => call.name)).toEqual(['inbox.lease'])
  })

  it('stops the batch when the local endpoint is unavailable, leaving later items leased', async () => {
    const items = [
      leased({ item: 1, kind: 'submit', payload: SUBMIT, created: 0, leased: 1, nonce: 1 }),
      leased({
        item: 2,
        kind: 'submit',
        payload: payloadOf('submit', submitArgs(2)),
        created: 0,
        leased: 1,
        nonce: 2
      })
    ]
    const site = scriptedSite({ 'inbox.lease': leaseOf(items), 'inbox.ack': ackResponse })
    const local = fakeLocalEndpoint({})
    const result = await consumerWith(site, local).run(binding())
    expect(result).toEqual({ kind: 'done', items: 0 })
    expect(local.calls).toHaveLength(1)
    expect(site.calls.map((call) => call.name)).toEqual(['inbox.lease'])
    expect(getDotRemoteItemJournal(owner).get(itemId(1))).toBeNull()
  })

  it('leases nothing while the local dot endpoint is not listening', async () => {
    const site = scriptedSite({})
    const local = fakeLocalEndpoint({})
    local.setReady(false)
    expect(await consumerWith(site, local).run(binding())).toEqual({ kind: 'done', items: 0 })
    expect(site.calls).toEqual([])
  })

  it('stops before the next item once the switch or the pairing changes', async () => {
    const items = [
      leased({ item: 1, kind: 'submit', payload: SUBMIT, created: 0, leased: 1, nonce: 1 }),
      leased({
        item: 2,
        kind: 'submit',
        payload: payloadOf('submit', submitArgs(2)),
        created: 0,
        leased: 1,
        nonce: 2
      })
    ]
    const site = scriptedSite({ 'inbox.lease': leaseOf(items), 'inbox.ack': ackResponse })
    const local = fakeLocalEndpoint({
      'dotIngress.requests.submit': () => {
        current = false
        return submitted()
      }
    })
    expect(await consumerWith(site, local).run(binding())).toEqual({ kind: 'stopped' })
    expect(local.calls).toHaveLength(1)
  })

  it('renews the lease while a dispatch runs long, with its nonce and generation', async () => {
    const item = leased({
      item: 1,
      kind: 'submit',
      payload: SUBMIT,
      created: 0,
      leased: 2,
      nonce: 1
    })
    let finish: (value: ReturnType<typeof submitted>) => void = () => undefined
    const site = scriptedSite({
      'inbox.lease': leaseOf([item]),
      'inbox.ack': ackResponse,
      'inbox.renew': (body) => {
        const renew = DotRemoteLeaseRenewRequestSchema.parse(body)
        return siteOk({
          itemId: renew.itemId,
          leaseNonce: renew.leaseNonce,
          leaseExpiresAt: new Date(clock.now() + 60_000).toISOString()
        })
      }
    })
    const local = fakeLocalEndpoint({
      'dotIngress.requests.submit': () => new Promise((resolve) => (finish = resolve))
    })
    const running = consumerWith(site, local).run(binding())
    await vi.waitFor(() => expect(local.calls).toHaveLength(1))
    await timers.advance(95_000)
    finish(submitted())
    await running
    const renewals = site.calls.filter((call) => call.name === 'inbox.renew')
    expect(renewals.length).toBeGreaterThanOrEqual(2)
    expect(renewals[0]).toEqual({
      name: 'inbox.renew',
      itemId: itemId(1),
      body: { itemId: itemId(1), leaseNonce: nonce(1), generation: 1 }
    })
    expect(timers.pending()).toBe(0)
  })

  it('names the request of a refused permission answer from the journal of its submit', async () => {
    getDotRemoteItemJournal(owner).record({
      itemId: itemId(1),
      kind: 'submit',
      payloadSha256: dotRemotePayloadSha256(SUBMIT),
      generation: 1,
      outcome: { outcome: 'accepted', dotRequestId: requestId(1) },
      dotRequestId: requestId(1),
      timestamp: at(1)
    })
    const payload = payloadOf('permission_answer', { decisionId: decisionId(1), decision: 'allow' })
    const item = leased({
      item: 2,
      kind: 'permission_answer',
      payload,
      created: 0,
      leased: 1,
      nonce: 2,
      dependsOn: 1
    })
    const site = scriptedSite({ 'inbox.lease': leaseOf([item]), 'inbox.ack': ackResponse })
    const local = fakeLocalEndpoint({
      'dotIngress.decisions.answer': () => refused('dot_decision_deny_only')
    })
    await consumerWith(site, local).run(binding())
    expect(site.calls[1]?.body).toMatchObject({
      outcome: 'refused',
      dotRequestId: requestId(1),
      refusal: dotRemoteNashRefusal('dot_decision_deny_only')
    })
  })

  it('acks an answered prompt with the request the decision belongs to', async () => {
    const payload = payloadOf('permission_answer', { decisionId: decisionId(1), decision: 'deny' })
    const item = leased({
      item: 2,
      kind: 'permission_answer',
      payload,
      created: 0,
      leased: 1,
      nonce: 2,
      dependsOn: 1
    })
    const site = scriptedSite({ 'inbox.lease': leaseOf([item]), 'inbox.ack': ackResponse })
    const decision = decisionView('Bash', 'Bash: git status', 0, false, {
      status: 'denied',
      by: 'dot',
      at: 2
    })
    const local = fakeLocalEndpoint({
      'dotIngress.decisions.answer': () => ({
        ok: true,
        result: { contractVersion: 3, outcome: 'decided', decision }
      })
    })
    await consumerWith(site, local).run(binding())
    expect(site.calls[1]?.body).toMatchObject({ outcome: 'accepted', dotRequestId: requestId(1) })
  })

  it('reports a message outcome with its ack', async () => {
    const payload = payloadOf('message', {
      dotRequestId: requestId(1),
      messageId: messageId(2),
      text: 'Also list the owners.'
    })
    const item = leased({
      item: 2,
      kind: 'message',
      payload,
      created: 0,
      leased: 1,
      nonce: 2,
      dependsOn: 1
    })
    const site = scriptedSite({ 'inbox.lease': leaseOf([item]), 'inbox.ack': ackResponse })
    const local = fakeLocalEndpoint({
      'dotIngress.requests.message': () => ({
        ok: true,
        result: {
          contractVersion: 3,
          dotRequestId: requestId(1),
          messageId: messageId(2),
          outcome: 'queued',
          reason: 'agent_busy',
          duplicate: false
        }
      })
    })
    await consumerWith(site, local).run(binding())
    expect(acked[0]?.messageOutcome).toEqual({
      messageId: messageId(2),
      outcome: 'queued',
      reason: 'agent_busy'
    })
  })

  it('returns a lease failure for the agent to act on', async () => {
    const site = scriptedSite({
      'inbox.lease': () => ({ ok: false, kind: 'site_error', code: 'generation_revoked' })
    })
    const result = await consumerWith(site, fakeLocalEndpoint({})).run(binding())
    expect(result).toEqual({
      kind: 'failure',
      failure: { kind: 'site_error', code: 'generation_revoked' }
    })
    expect(dotRemoteError('generation_revoked').error.code).toBe('generation_revoked')
  })

  it('treats a lease answered for another generation as revoked', async () => {
    const site = scriptedSite({
      'inbox.lease': () => siteOk({ generation: 2, serverTime: at(1), items: [] })
    })
    const result = await consumerWith(site, fakeLocalEndpoint({})).run(binding())
    expect(result).toEqual({
      kind: 'failure',
      failure: { kind: 'site_error', code: 'generation_revoked' }
    })
  })

  it('logs a lease renewal that throws by code, and the dispatch still finishes', async () => {
    const item = leased({
      item: 1,
      kind: 'submit',
      payload: SUBMIT,
      created: 0,
      leased: 2,
      nonce: 1
    })
    let finish: (value: ReturnType<typeof submitted>) => void = () => undefined
    const site = scriptedSite({
      'inbox.lease': leaseOf([item]),
      'inbox.ack': ackResponse,
      'inbox.renew': () => {
        throw Object.assign(new Error('Fixture: socket reset at C:\\private'), {
          code: 'ECONNRESET'
        })
      }
    })
    const local = fakeLocalEndpoint({
      'dotIngress.requests.submit': () => new Promise((resolve) => (finish = resolve))
    })
    const running = consumerWith(site, local).run(binding())
    await vi.waitFor(() => expect(local.calls).toHaveLength(1))
    await timers.advance(45_000)
    expect(log).toHaveBeenCalledWith({
      event: 'dot_remote_lease_renew_failed',
      code: 'ECONNRESET',
      itemId: itemId(1)
    })
    finish(submitted())
    await expect(running).resolves.toEqual({ kind: 'done', items: 1 })
    expect(JSON.stringify(log.mock.calls)).not.toContain('private')
  })
})

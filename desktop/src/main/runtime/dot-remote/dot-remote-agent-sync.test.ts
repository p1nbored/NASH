import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  messageId,
  payloadOf,
  requestId,
  submitArgs
} from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { createAgentHarness, type AgentHarness } from './dot-remote-agent.test-fixture'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import { FIXTURE_SERVICE_VALUE } from './dot-remote.test-fixture'

const SUBMIT = payloadOf('submit', submitArgs(1))

describe('dot remote agent: polling, items, events and revocation', () => {
  let h: AgentHarness
  beforeEach(async () => {
    h = createAgentHarness()
    await h.pair()
  })
  afterEach(() => h.close())

  const leases = () => h.site.calls.filter((call) => call === 'POST /nash/v1/inbox/lease').length

  it('polls every 30 s while idle', async () => {
    const before = leases()
    await h.timers.advance(90_000)
    expect(leases() - before).toBe(3)
  })

  it('hands a leased submit to the local endpoint, acks it and reports its status', async () => {
    h.site.enqueue('submit', SUBMIT)
    await h.timers.advance(30_000)
    expect(h.local.calls.map((call) => call.method)).toEqual(['dotIngress.requests.submit'])
    expect(h.local.calls[0]?.params.idempotencyKey).toBe(SUBMIT.idempotencyKey)
    expect(h.site.acks).toEqual([
      expect.objectContaining({ outcome: 'accepted', dotRequestId: requestId(1) })
    ])
    expect(h.site.events.map((event) => [event.kind, event.sourceRevision])).toEqual([
      ['request_status', 1]
    ])
  })

  it('polls every 5 s while a run is active', async () => {
    h.site.enqueue('submit', SUBMIT)
    await h.timers.advance(30_000)
    const before = leases()
    await h.timers.advance(20_000)
    expect(leases() - before).toBe(4)
  })

  it('reports the first message outcome from its ack', async () => {
    h.site.enqueue('submit', SUBMIT)
    await h.timers.advance(30_000)
    const submitItem = h.site.acks.length
    expect(submitItem).toBe(1)
    h.local.endpoint.call = async (method) =>
      method === 'dotIngress.requests.message'
        ? {
            ok: true,
            result: {
              contractVersion: 3,
              dotRequestId: requestId(1),
              messageId: messageId(2),
              outcome: 'queued',
              reason: 'agent_busy',
              duplicate: false
            }
          }
        : { ok: false, kind: 'unavailable' }
    h.site.enqueue(
      'message',
      payloadOf('message', {
        dotRequestId: requestId(1),
        messageId: messageId(2),
        text: 'Also list the owners.'
      }),
      { dependsOnItemId: '10000000-0000-4000-8000-000000000002' }
    )
    await h.timers.advance(5_000)
    expect(
      h.site.events.filter((event) => event.kind === 'message_outcome').map((event) => event.data)
    ).toEqual([{ messageId: messageId(2), outcome: 'queued', reason: 'agent_busy' }])
  })

  it('renews the session with its generation only, before it ends', async () => {
    await h.timers.advance(10 * 60_000)
    expect(h.site.calls).toContain('POST /nash/v1/session/renew')
    await h.timers.advance(10 * 60_000)
    expect(h.agent.status().state).toBe('connected')
  })

  it('goes offline on a network failure and recovers on the next poll', async () => {
    h.site.failNext('POST /nash/v1/heartbeat', new Response('down', { status: 503 }))
    await h.timers.advance(30_000)
    expect(h.agent.status().state).toBe('offline')
    await h.timers.advance(30_000)
    expect(h.agent.status().state).toBe('connected')
  })

  it('stops at once and asks to pair again when the Site revokes the pairing', async () => {
    h.site.revokeOnSite()
    await h.timers.advance(30_000)
    expect(h.agent.status()).toMatchObject({
      state: 'pair_again',
      reconnectReason: 'pairing_revoked',
      pairing: null
    })
    expect(h.credentials.deviceValue()).toBeNull()
    const calls = h.site.calls.length
    await h.timers.advance(120_000)
    expect(h.site.calls.length).toBe(calls)
  })

  it('stops at once on a 403 and asks for a reconnect, with no fallback', async () => {
    h.site.rejectServiceToken()
    await h.timers.advance(30_000)
    expect(h.agent.status()).toMatchObject({
      state: 'reconnect_needed',
      reconnectReason: 'service_token_rejected'
    })
    const calls = h.site.calls.length
    await h.timers.advance(120_000)
    expect(h.site.calls.length).toBe(calls)
  })

  it('revokes from the desktop, fences the generation and cancels no run', async () => {
    h.site.enqueue('submit', SUBMIT)
    await h.timers.advance(30_000)
    h.snapshots.current = {
      ...h.snapshots.current!,
      validations: [{ validationId: 'v1', verdict: 'pass', line: null }]
    }
    h.site.failNext('POST /nash/v1/events', new Response('down', { status: 503 }))
    await h.timers.advance(5_000)
    expect(getDotRemoteOutboxStore(h.owner).countPending()).toBeGreaterThan(0)
    const result = await h.agent.revoke()
    expect(result.siteConfirmed).toBe(true)
    expect(result.status).toMatchObject({ state: 'unpaired', pairing: null, pendingEvents: 0 })
    expect(h.credentials.deviceValue()).toBeNull()
    expect(h.site.generation()).toBe(2)
    expect(h.local.calls.map((call) => call.method)).toEqual(['dotIngress.requests.submit'])
    const calls = h.site.calls.length
    await h.timers.advance(120_000)
    expect(h.site.calls.length).toBe(calls)
  })

  it('stops polling at once when switched off, and resumes when switched on', async () => {
    h.agent.disable()
    const calls = h.site.calls.length
    await h.timers.advance(120_000)
    expect(h.site.calls.length).toBe(calls)
    expect(h.agent.status().state).toBe('off')
    h.agent.enable()
    await h.timers.advance(1_000)
    expect(h.site.calls.length).toBeGreaterThan(calls)
    expect(h.agent.status().state).toBe('connected')
  })

  it('stops polling and flushes the outbox once on quit', async () => {
    h.site.enqueue('submit', SUBMIT)
    h.site.failNext('POST /nash/v1/events', new Response('down', { status: 503 }))
    await h.timers.advance(30_000)
    expect(getDotRemoteOutboxStore(h.owner).countPending()).toBe(1)
    h.clock.advance(10_000)
    await h.agent.stop()
    expect(getDotRemoteOutboxStore(h.owner).countPending()).toBe(0)
    const calls = h.site.calls.length
    await h.timers.advance(120_000)
    expect(h.site.calls.length).toBe(calls)
  })

  it('never writes a token into a log line', async () => {
    h.site.enqueue('submit', SUBMIT)
    await h.timers.advance(60_000)
    await h.agent.revoke()
    const logged = JSON.stringify(h.log.mock.calls)
    expect(logged).not.toContain(FIXTURE_SERVICE_VALUE)
    expect(logged).not.toContain('FIXTURE0session0')
    expect(logged).not.toContain('FIXTUREdeviceCredentialSecret')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOT_REQUEST_STATUS_TEXT } from '../../../shared/dot-ingress/dot-ingress-status-text'
import type { DotValidationView } from '../../../shared/dot-ingress/dot-ingress-validation'
import { DotRemoteAckRequestSchema } from '../../../shared/dot-remote/dot-remote-ack'
import { dotRemoteNashRefusal } from '../../../shared/dot-remote/dot-remote-errors'
import { DotRemoteEventSchema } from '../../../shared/dot-remote/dot-remote-events'
import { dotRemotePayloadSha256 } from '../../../shared/dot-remote/dot-remote-payload'
import {
  at,
  decisionId,
  itemId,
  leased,
  payloadOf,
  requestId
} from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createDotRemoteConsumer } from './dot-remote-consumer'
import type { DotRemoteRequestSnapshot } from './dot-remote-event-source'
import { createDotRemoteEventSync } from './dot-remote-event-sync'
import { DOT_REMOTE_LONG_DISPATCH_TIMEOUT_MS } from './dot-remote-item-dispatch'
import { getDotRemoteItemJournal } from './dot-remote-item-journal'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import { getDotRemoteRequestStore } from './dot-remote-request-store'
import { ensureDotRemoteSchema } from './dot-remote-schema'
import {
  fakeLocalEndpoint,
  fixtureClock,
  fixtureCredentials,
  manualTimers,
  scriptedSite,
  siteOk
} from './dot-remote.test-fixture'

// FIXTURE_ONLY: a dot validation decision through the relay: the leased decide item, its ack, and
// the pending and settled events the sync reports. The local readers are tested with real stores in
// dot-remote-validation-facts.test.ts.

const VALIDATION_ID = 'validation_70000000-0000-4000-8000-000000000001'
const ARGS = { decisionId: decisionId(11), validationId: VALIDATION_ID, decision: 'waive' }
const PAYLOAD = payloadOf('validation_decision', ARGS)
const VIEW: DotValidationView = {
  validationId: VALIDATION_ID,
  dotRequestId: requestId(1),
  title: 'Summarize the open issues',
  reason: 'primary_did_task',
  summary: 'Listed four open issues.',
  summaryWithheld: false,
  createdAt: at(3)
}
const WAIVED = { validationId: VALIDATION_ID, outcome: 'waived' as const, decidedAt: at(9) }

function decided(outcome: string, duplicate = false) {
  return {
    ok: true as const,
    result: {
      contractVersion: 3,
      decisionId: ARGS.decisionId,
      validationId: VALIDATION_ID,
      dotRequestId: requestId(1),
      outcome,
      decidedAt: outcome === 'closed' ? null : at(9),
      duplicate
    }
  }
}

describe('validation decision items', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ensureDotRemoteSchema(owner.db)
    getDotRemoteItemJournal(owner).record({
      itemId: itemId(1),
      kind: 'submit',
      payloadSha256: 'a'.repeat(64),
      generation: 1,
      outcome: { outcome: 'accepted', dotRequestId: requestId(1) },
      dotRequestId: requestId(1),
      timestamp: at(1)
    })
  })
  afterEach(() => owner.close())

  async function relay(answer: ReturnType<typeof fakeLocalEndpoint>) {
    const item = leased({
      item: 2,
      kind: 'validation_decision',
      payload: PAYLOAD,
      created: 0,
      leased: 1,
      nonce: 2,
      dependsOn: 1
    })
    const site = scriptedSite({
      'inbox.lease': () => siteOk({ generation: 1, serverTime: at(1), items: [item] }),
      'inbox.ack': (body) => {
        const ack = DotRemoteAckRequestSchema.parse(body)
        return siteOk({ itemId: ack.itemId, recorded: 'applied', receiptState: 'accepted' })
      }
    })
    const clock = fixtureClock(2)
    await createDotRemoteConsumer({
      site: site.client,
      endpoint: answer.endpoint,
      journal: getDotRemoteItemJournal(owner),
      now: clock.now,
      timers: manualTimers(clock).timers,
      log: vi.fn(),
      isCurrent: (generation) => generation === 1,
      onAcked: () => undefined
    }).run({ credentials: fixtureCredentials(), generation: 1 })
    return site.calls.filter((call) => call.name === 'inbox.ack').map((call) => call.body)
  }

  it('relays the decide params exactly as dot sent them and acks a first decision as accepted', async () => {
    const local = fakeLocalEndpoint({ 'dotIngress.validations.decide': () => decided('decided') })
    const acks = await relay(local)
    expect(local.calls).toEqual([
      {
        method: 'dotIngress.validations.decide',
        params: PAYLOAD,
        timeoutMs: DOT_REMOTE_LONG_DISPATCH_TIMEOUT_MS
      }
    ])
    expect(acks).toEqual([
      expect.objectContaining({
        itemId: itemId(2),
        payloadSha256: dotRemotePayloadSha256(PAYLOAD),
        outcome: 'accepted',
        dotRequestId: requestId(1)
      })
    ])
  })

  it('acks a decisionId NASH answered before as duplicate', async () => {
    const local = fakeLocalEndpoint({
      'dotIngress.validations.decide': () => decided('decided', true)
    })
    expect(await relay(local)).toEqual([
      expect.objectContaining({ outcome: 'duplicate', dotRequestId: requestId(1) })
    ])
  })

  it.each(['already_decided', 'closed'])(
    'acks %s as accepted; the settled event says what happened',
    async (outcome) => {
      const local = fakeLocalEndpoint({ 'dotIngress.validations.decide': () => decided(outcome) })
      expect(await relay(local)).toEqual([
        expect.objectContaining({ outcome: 'accepted', dotRequestId: requestId(1) })
      ])
    }
  )

  it('refuses an unknown validation with the request of the submit it follows', async () => {
    const local = fakeLocalEndpoint({
      'dotIngress.validations.decide': () => ({
        ok: false,
        kind: 'refused',
        code: 'dot_validation_not_found'
      })
    })
    expect(await relay(local)).toEqual([
      expect.objectContaining({
        outcome: 'refused',
        dotRequestId: requestId(1),
        refusal: dotRemoteNashRefusal('dot_validation_not_found')
      })
    ])
  })

  it('acks nothing for an answer that is not the version 3 decide result', async () => {
    const local = fakeLocalEndpoint({
      'dotIngress.validations.decide': () => ({
        ok: true,
        result: { ...decided('decided').result, contractVersion: 2 }
      })
    })
    expect(await relay(local)).toEqual([])
  })
})

describe('validation decision events', () => {
  let owner: OrchestrationDb
  let current: DotRemoteRequestSnapshot
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ensureDotRemoteSchema(owner.db)
    getDotRemoteRequestStore(owner).track({
      dotRequestId: requestId(1),
      submitItemId: itemId(1),
      generation: 1,
      timestamp: at(0)
    })
    current = {
      status: {
        state: 'submitted',
        statusText: DOT_REQUEST_STATUS_TEXT.submitted,
        run: { state: 'completed', blocker: null }
      },
      prompts: [],
      messages: [],
      validations: [],
      deliverable: { summary: null, artifacts: [] },
      validationDecisions: [{ kind: 'pending', view: VIEW }],
      awaitsValidationDecision: true
    }
  })
  afterEach(() => owner.close())

  function syncWith(source: {
    snapshot: (dotRequestId: string, known: unknown) => DotRemoteRequestSnapshot
    beginSync?: (followed: readonly string[]) => void
  }) {
    let ids = 0
    return createDotRemoteEventSync({
      owner,
      source,
      now: fixtureClock(5).now,
      newEventId: () => `60000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
      log: vi.fn()
    })
  }

  const decisionEvents = () =>
    getDotRemoteOutboxStore(owner)
      .pending(1, 50)
      .filter((event) => event.kind.startsWith('validation_decision_'))

  it('reports a waiting decision once with exactly its view, then its settlement once', () => {
    const sync = syncWith({ snapshot: () => current })
    sync.run()
    sync.run()
    current = {
      ...current,
      validationDecisions: [{ kind: 'settled', settled: WAIVED }],
      awaitsValidationDecision: false
    }
    sync.run()
    sync.run()
    const events = decisionEvents()
    expect(events.map((event) => [event.kind, event.data])).toEqual([
      ['validation_decision_pending', VIEW],
      ['validation_decision_settled', WAIVED]
    ])
    for (const event of events) {
      expect(DotRemoteEventSchema.parse(event)).toEqual(event)
    }
  })

  it('passes the reported validation ids back and names the followed requests first', () => {
    const order: string[] = []
    const source = {
      beginSync: vi.fn((followed: readonly string[]) => order.push(`begin:${followed.join()}`)),
      snapshot: vi.fn((dotRequestId: string) => {
        order.push(`read:${dotRequestId}`)
        return current
      })
    }
    const sync = syncWith(source)
    sync.run()
    sync.run()
    expect(order).toEqual([
      `begin:${requestId(1)}`,
      `read:${requestId(1)}`,
      `begin:${requestId(1)}`,
      `read:${requestId(1)}`
    ])
    expect(source.snapshot).toHaveBeenLastCalledWith(requestId(1), {
      messageIds: [],
      validationIds: [VALIDATION_ID]
    })
  })

  it('keeps following an ended run while a decision waits, and stops once none waits', () => {
    const requests = getDotRemoteRequestStore(owner)
    const sync = syncWith({ snapshot: () => current })
    sync.run()
    current = { ...current, validationDecisions: [] }
    sync.run()
    expect(requests.listOpen(10).map((request) => request.dotRequestId)).toEqual([requestId(1)])
    current = {
      ...current,
      validationDecisions: [{ kind: 'settled', settled: WAIVED }],
      awaitsValidationDecision: false
    }
    sync.run()
    expect(requests.listOpen(10)).toEqual([])
  })
})

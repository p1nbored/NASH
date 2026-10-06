import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOT_MESSAGE_TEXT_MAX_CHARS } from '../../../shared/dot-ingress/dot-ingress-message'
import { RUN_MESSAGE_TEXT_MAX_CHARS } from '../orchestration/db/autopilot-message-schema-definition'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { getRunMessageStore } from '../orchestration/db/run-message-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type {
  RunMessageDeliveryInput,
  RunMessageDeliveryResult
} from '../workflow-run/run-message-delivery'
import { submitDotRequest } from './dot-ingress-intake'
import { sendDotMessage } from './dot-ingress-message-service'
import { findDotRequestRun } from './dot-ingress-run-link'
import {
  FIXTURE_NOW_MS,
  createDotHarness,
  fixtureUuid,
  rejectionCodeOf,
  type DotHarness
} from './dot-ingress-service.test-fixture'

const TEXT = 'Also list the owners of `docs/plan.md`.'

type FakeMessenger = {
  readonly calls: RunMessageDeliveryInput[]
  next: RunMessageDeliveryResult
  deliverRunMessage(input: RunMessageDeliveryInput): Promise<RunMessageDeliveryResult>
}

function result(overrides: Partial<RunMessageDeliveryResult> = {}): RunMessageDeliveryResult {
  return {
    outcome: 'delivered',
    reason: null,
    messageId: 'message-fixture-1',
    state: 'delivered',
    duplicate: false,
    ...overrides
  }
}

function createFakeMessenger(): FakeMessenger {
  const messenger: FakeMessenger = {
    calls: [],
    next: result(),
    deliverRunMessage: async (input) => {
      messenger.calls.push(input)
      return messenger.next
    }
  }
  return messenger
}

describe('dot follow-up messages (D-019)', () => {
  let harness: DotHarness
  let messenger: FakeMessenger
  beforeEach(() => {
    harness = createDotHarness()
    messenger = createFakeMessenger()
    harness.setMessenger(messenger)
  })
  afterEach(() => harness.close())

  async function submitted(n = 1) {
    return (
      await submitDotRequest(
        harness.deps,
        harness.submitRequest({ idempotencyKey: fixtureUuid(n) })
      )
    ).record
  }

  function message(dotRequestId: string, n = 50) {
    return { dotRequestId, messageId: fixtureUuid(n), text: TEXT }
  }

  it('never lets dot send more than the run message store holds', () => {
    // D-027 raised the store to a technical ceiling; the dot v2 wire bound and its remote manifest
    // stay until that contract is revised with the Site, so dot can only send less.
    expect(DOT_MESSAGE_TEXT_MAX_CHARS).toBeLessThanOrEqual(RUN_MESSAGE_TEXT_MAX_CHARS)
  })

  it('delivers to the run the dot request started, as a dot message with its id', async () => {
    const record = await submitted()
    const outcome = await sendDotMessage(harness.deps, message(record.dotRequestId))

    expect(outcome).toEqual({ outcome: 'delivered', reason: null, duplicate: false })
    expect(messenger.calls).toEqual([
      {
        runId: findDotRequestRun(harness.owner, record)?.runId,
        source: 'dot',
        sourceRequestId: fixtureUuid(50),
        text: TEXT
      }
    ])
  })

  it.each([
    [
      result({ outcome: 'queued', reason: 'agent_busy', state: 'delivered' }),
      'queued',
      'agent_busy'
    ],
    [result({ outcome: 'queued', reason: 'dialog_open', state: 'held' }), 'queued', 'dialog_open'],
    [
      result({ outcome: 'refused', reason: 'not_english', state: 'refused' }),
      'refused',
      'not_english'
    ],
    [
      result({ outcome: 'refused', reason: 'secret_shaped', state: 'refused' }),
      'refused',
      'secret_shaped'
    ],
    [result({ outcome: 'refused', reason: 'run_not_owned_by_source' }), 'refused', 'other'],
    [result({ outcome: 'refused', reason: 'invalid_request', messageId: null }), 'refused', 'other']
  ])(
    'reports the delivery outcome with a coarse reason, passing historic not_english and secret_shaped codes through',
    async (next, outcome, reason) => {
      const record = await submitted()
      messenger.next = next
      expect(await sendDotMessage(harness.deps, message(record.dotRequestId))).toEqual({
        outcome,
        reason,
        duplicate: false
      })
    }
  )

  it('reports a replay as a duplicate, and a reused id with other text as a conflict', async () => {
    const record = await submitted()
    messenger.next = result({ duplicate: true })
    expect(await sendDotMessage(harness.deps, message(record.dotRequestId))).toMatchObject({
      duplicate: true
    })
    messenger.next = result({
      outcome: 'refused',
      reason: 'request_id_reused',
      messageId: null,
      state: null
    })
    expect(
      await rejectionCodeOf(() => sendDotMessage(harness.deps, message(record.dotRequestId)))
    ).toBe('dot_idempotency_conflict')
  })

  it('refuses without storing anything when the request has no run yet', async () => {
    harness.door.launch = 'received'
    const unlaunched = await submitted(1)
    harness.door.failNextSubmit = new OrchestrationError('workbench_recovery_required', 'fixture')
    const received = await submitted(2)
    for (const record of [unlaunched, received]) {
      expect(await sendDotMessage(harness.deps, message(record.dotRequestId))).toEqual({
        outcome: 'refused',
        reason: 'run_not_started',
        duplicate: false
      })
    }
    expect(messenger.calls).toEqual([])
  })

  it('refuses a message to a request that failed or was canceled', async () => {
    harness.door.failNextSubmit = new OrchestrationError('workbench_capacity_exceeded', 'fixture')
    const failed = await submitted(1)
    expect(await sendDotMessage(harness.deps, message(failed.dotRequestId))).toEqual({
      outcome: 'refused',
      reason: 'run_not_active',
      duplicate: false
    })
    expect(messenger.calls).toEqual([])
  })

  it('refuses before delivery when the run cannot be proven to come from this request', async () => {
    const record = await submitted()
    harness.owner.db
      .prepare(
        "UPDATE workbench_requests SET principal_id = 'local-desktop-ui' WHERE request_id = ?"
      )
      .run(record.workbenchRequestId)
    expect(
      await rejectionCodeOf(() => sendDotMessage(harness.deps, message(record.dotRequestId)))
    ).toBe('dot_recovery_required')
    expect(messenger.calls).toEqual([])
  })

  it('applies the submission caps to new messages, but never to a replay', async () => {
    const record = await submitted()
    const run = findDotRequestRun(harness.owner, record)
    getDotIngressSettingsStore(harness.owner).setRateLimits({
      ratePerMinute: 2,
      ratePerUtcDay: 100,
      timestamp: new Date(FIXTURE_NOW_MS).toISOString()
    })
    const store = getRunMessageStore(harness.owner)
    for (const n of [60, 61]) {
      store.recordRefused({
        runId: run?.runId ?? '',
        source: 'dot',
        sourceRequestId: fixtureUuid(n),
        textSha256: 'e'.repeat(64),
        text: null,
        reason: 'text_empty',
        timestamp: new Date(FIXTURE_NOW_MS).toISOString()
      })
    }
    let refusal: unknown = null
    try {
      await sendDotMessage(harness.deps, message(record.dotRequestId, 62))
    } catch (error) {
      refusal = error
    }
    expect(refusal).toMatchObject({ code: 'dot_rate_limited', data: { window: 'minute' } })
    expect(messenger.calls).toEqual([])

    messenger.next = result({ duplicate: true })
    expect(await sendDotMessage(harness.deps, message(record.dotRequestId, 61))).toMatchObject({
      duplicate: true
    })
    harness.advanceClock(61_000)
    expect(await sendDotMessage(harness.deps, message(record.dotRequestId, 63))).toMatchObject({
      outcome: 'delivered'
    })
  })

  it('reports a refusal when the primary-session runtime is not running', async () => {
    const record = await submitted()
    harness.setMessenger(null)
    expect(await sendDotMessage(harness.deps, message(record.dotRequestId))).toEqual({
      outcome: 'refused',
      reason: 'primary_not_live',
      duplicate: false
    })
  })

  it('refuses an unknown request and every message while the interface is off', async () => {
    const record = await submitted()
    expect(
      await rejectionCodeOf(() => sendDotMessage(harness.deps, message(fixtureUuid(99))))
    ).toBe('dot_request_not_found')
    getDotIngressSettingsStore(harness.owner).setEnabled({
      enabled: false,
      timestamp: new Date(FIXTURE_NOW_MS).toISOString()
    })
    expect(
      await rejectionCodeOf(() => sendDotMessage(harness.deps, message(record.dotRequestId)))
    ).toBe('dot_ingress_disabled')
  })
})

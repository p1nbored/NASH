import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DotRemoteAckRequestSchema } from './dot-remote-ack'
import {
  DOT_REMOTE_TOOL_ERROR_CODES,
  DotRemoteNashRefusalSchema,
  dotRemoteNashRefusal
} from './dot-remote-errors'
import { DOT_REMOTE_EVENT_VARIANTS, DotRemoteEventSchema } from './dot-remote-events'
import { DotRemoteInboxItemSchema } from './dot-remote-inbox'
import { DOT_REMOTE_VALIDATION_DECISIONS_OPEN_MAX } from './dot-remote-limits'
import { dotRemoteInboxPayload, dotRemotePayloadSha256 } from './dot-remote-payload'
import { DotRemoteStatusViewSchema } from './dot-remote-presence'
import {
  DotRemoteReceiptSchema,
  DotRemoteValidationDecisionReceiptSchema
} from './dot-remote-receipt'
import { DotRemoteRequestProjectionSchema } from './dot-remote-tool-views'
import { dotRemoteTool } from './dot-remote-tools'
import { propertyNames } from './dot-remote-json-schema-walk.test-fixture'

const REQUEST_ID = '30000000-0000-4000-8000-000000000001'
const OTHER_REQUEST_ID = '30000000-0000-4000-8000-000000000002'
const ITEM_ID = '10000000-0000-4000-8000-000000000003'
const SUBMIT_ITEM_ID = '10000000-0000-4000-8000-000000000001'
const DECISION_ID = '40000000-0000-4000-8000-000000000009'
const EVENT_ID = '60000000-0000-4000-8000-000000000001'
const VALIDATION_ID = 'validation_70000000-0000-4000-8000-000000000001'
const AT = '2026-10-05T12:00:05.000Z'

const PENDING = {
  validationId: VALIDATION_ID,
  dotRequestId: REQUEST_ID,
  title: 'Summarize the open issues',
  reason: 'review_unavailable',
  summary: null,
  summaryWithheld: true,
  createdAt: AT
}

function event(kind: string, data: unknown, dotRequestId = REQUEST_ID) {
  return { eventId: EVENT_ID, kind, dotRequestId, sourceRevision: 2, at: AT, data }
}

const DECIDE_INPUT = { decisionId: DECISION_ID, validationId: VALIDATION_ID, decision: 'reject' }

describe('validation decision events', () => {
  it('reports a waiting decision with exactly the approved fields, on its own request', () => {
    const pending = event('validation_decision_pending', PENDING)
    expect(DotRemoteEventSchema.safeParse(pending).success).toBe(true)
    expect(
      DotRemoteEventSchema.safeParse(
        event('validation_decision_pending', PENDING, OTHER_REQUEST_ID)
      ).success
    ).toBe(false)
    for (const extra of ['path', 'branch', 'worktree', 'model', 'objective']) {
      expect(
        DotRemoteEventSchema.safeParse(
          event('validation_decision_pending', { ...PENDING, [extra]: 'x' })
        ).success,
        extra
      ).toBe(false)
    }
    expect(
      DotRemoteEventSchema.safeParse(
        event('validation_decision_pending', { ...PENDING, summary: 'Shown.' })
      ).success
    ).toBe(false)
  })

  it('reports how a decision ended with a time, except when it closed without one', () => {
    const settled = { validationId: VALIDATION_ID, outcome: 'rejected', decidedAt: AT }
    expect(
      DotRemoteEventSchema.safeParse(event('validation_decision_settled', settled)).success
    ).toBe(true)
    const closed = { validationId: VALIDATION_ID, outcome: 'closed', decidedAt: null }
    expect(
      DotRemoteEventSchema.safeParse(event('validation_decision_settled', closed)).success
    ).toBe(true)
    expect(
      DotRemoteEventSchema.safeParse(
        event('validation_decision_settled', { ...settled, decidedAt: null })
      ).success
    ).toBe(false)
    expect(
      propertyNames(z.toJSONSchema(DOT_REMOTE_EVENT_VARIANTS.validation_decision_settled)).sort()
    ).toEqual(
      [
        'at',
        'data',
        'decidedAt',
        'dotRequestId',
        'eventId',
        'kind',
        'outcome',
        'sourceRevision',
        'validationId'
      ].sort()
    )
  })

  it('folds the newest event per validation into the request view', () => {
    const shape = DotRemoteRequestProjectionSchema.shape.validationDecisions
    expect(shape.safeParse([event('validation_decision_pending', PENDING)]).success).toBe(true)
    expect(
      shape.safeParse([
        event('validation_decision_settled', {
          validationId: VALIDATION_ID,
          outcome: 'waived',
          decidedAt: AT
        })
      ]).success
    ).toBe(true)
  })
})

describe('validation decision items and receipts', () => {
  const payload = dotRemoteInboxPayload('validation_decision', DECIDE_INPUT)
  const item = {
    itemId: ITEM_ID,
    kind: 'validation_decision',
    payload,
    payloadSha256: dotRemotePayloadSha256(payload),
    dependsOnItemId: SUBMIT_ITEM_ID,
    createdAt: AT,
    expiresAt: '2026-10-05T12:30:05.000Z',
    lease: {
      leaseNonce: 'FIXTURElease0nonce000000000001',
      generation: 1,
      leaseExpiresAt: '2026-10-05T12:01:05.000Z'
    }
  }

  it('stores the version 3 decide params as the payload, with contractVersion injected', () => {
    expect(payload).toEqual({ ...DECIDE_INPUT, contractVersion: 3 })
    expect(DotRemoteInboxItemSchema.safeParse(item).success).toBe(true)
    expect(DotRemoteInboxItemSchema.safeParse({ ...item, dependsOnItemId: null }).success).toBe(
      false
    )
  })

  it("keeps dot's decisionId and refuses one taken from the item id", () => {
    const derived = dotRemoteInboxPayload('validation_decision', {
      ...DECIDE_INPUT,
      decisionId: ITEM_ID
    })
    const forged = { ...item, payload: derived, payloadSha256: dotRemotePayloadSha256(derived) }
    expect(DotRemoteInboxItemSchema.safeParse(forged).success).toBe(false)
  })

  it('has a receipt like every other control item, refused with the NASH code', () => {
    const base = {
      itemId: ITEM_ID,
      kind: 'validation_decision',
      payloadSha256: item.payloadSha256,
      dependsOnItemId: SUBMIT_ITEM_ID,
      dotRequestId: REQUEST_ID,
      createdAt: AT,
      expiresAt: item.expiresAt,
      updatedAt: AT
    }
    for (const receipt of [
      { ...base, state: 'queued' },
      { ...base, state: 'accepted', duplicate: false },
      { ...base, state: 'refused', refusal: dotRemoteNashRefusal('dot_validation_not_found') }
    ]) {
      expect(DotRemoteValidationDecisionReceiptSchema.safeParse(receipt).success).toBe(true)
      expect(DotRemoteReceiptSchema.safeParse(receipt).success).toBe(true)
    }
    expect(
      DotRemoteNashRefusalSchema.safeParse(dotRemoteNashRefusal('dot_validation_not_found')).success
    ).toBe(true)
    expect(
      DotRemoteAckRequestSchema.safeParse({
        itemId: ITEM_ID,
        leaseNonce: item.lease.leaseNonce,
        generation: 1,
        payloadSha256: item.payloadSha256,
        ackedAt: AT,
        outcome: 'refused',
        dotRequestId: REQUEST_ID,
        refusal: dotRemoteNashRefusal('dot_validation_not_found')
      }).success
    ).toBe(true)
  })
})

describe('validation decision tools', () => {
  it('lists waiting decisions oldest first with a cursor, never with contractVersion', () => {
    const list = dotRemoteTool('nash_list_validation_decisions')
    expect(list.input.safeParse({}).success).toBe(true)
    expect(
      list.input.safeParse({ dotRequestId: REQUEST_ID, limit: 50, cursor: 'abc' }).success
    ).toBe(true)
    expect(list.input.safeParse({ limit: 51 }).success).toBe(false)
    expect(list.input.safeParse({ contractVersion: 3 }).success).toBe(false)
    expect(list.output.safeParse({ validations: [PENDING], nextCursor: null }).success).toBe(true)
  })

  it('decides by decisionId with waive or reject and returns a receipt', () => {
    const decide = dotRemoteTool('nash_decide_validation')
    expect(decide.input.safeParse(DECIDE_INPUT).success).toBe(true)
    for (const bad of [
      { ...DECIDE_INPUT, decision: 'allow' },
      { ...DECIDE_INPUT, by: 'desktop_user' },
      { ...DECIDE_INPUT, contractVersion: 3 }
    ]) {
      expect(decide.input.safeParse(bad).success).toBe(false)
    }
    expect(propertyNames(z.toJSONSchema(decide.output))).toContain('itemId')
  })

  it('refuses a decision the Site does not hold as waiting with its own code', () => {
    expect(DOT_REMOTE_TOOL_ERROR_CODES).toContain('validation_decision_not_open')
    expect(DOT_REMOTE_VALIDATION_DECISIONS_OPEN_MAX).toBe(50)
  })

  it('shows on nash_status the hash of the manifest the Site serves', () => {
    const status = {
      paired: false,
      online: false,
      lastSeenAt: null,
      appVersion: null,
      contractVersion: null,
      onlineWindowSeconds: 90,
      manifestSha256: 'a'.repeat(64)
    }
    expect(DotRemoteStatusViewSchema.safeParse(status).success).toBe(true)
    const { manifestSha256: _hash, ...withoutHash } = status
    expect(DotRemoteStatusViewSchema.safeParse(withoutHash).success).toBe(false)
  })
})

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  DOT_INGRESS_ERROR_CODES_V3,
  dotIngressErrorMessageV3
} from '../dot-ingress/dot-ingress-errors-v3'
import { DOT_INGRESS_ERROR_MESSAGES } from '../dot-ingress/dot-ingress-errors'
import {
  DotCancelParamsV3,
  DotDecisionAnswerParamsV3,
  DotMessageParamsV3,
  DotSubmitParamsV3
} from '../dot-ingress/dot-ingress-v3'
import { DotValidationDecideParamsV3 } from '../dot-ingress/dot-ingress-validation'
import { DotRemoteAckRequestSchema } from './dot-remote-ack'
import { DotRemoteNashRefusalSchema, dotRemoteNashRefusal } from './dot-remote-errors'
import {
  DOT_REMOTE_INBOX_ITEM_VARIANTS,
  DotRemoteInboxItemSchema,
  DotRemoteLeaseResponseSchema
} from './dot-remote-inbox'
import { DOT_REMOTE_MAX_ITEMS_PER_LEASE } from './dot-remote-limits'
import {
  DOT_REMOTE_ITEM_KINDS,
  DOT_REMOTE_ITEM_METHODS,
  DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS,
  dotRemoteCanonicalPayload,
  dotRemoteInboxPayload,
  dotRemotePayloadSha256
} from './dot-remote-payload'

const ITEM_ID = '10000000-0000-4000-8000-000000000001'
const SUBMIT_ITEM_ID = '10000000-0000-4000-8000-000000000002'
const KEY = '20000000-0000-4000-8000-000000000001'
const REQUEST_ID = '30000000-0000-4000-8000-000000000001'
const T0 = '2026-10-05T12:00:00.000Z'
const LEASE = {
  leaseNonce: 'FIXTURElease0nonce000000000001',
  generation: 1,
  leaseExpiresAt: '2026-10-05T12:01:00.000Z'
}

function submitPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 3,
    workspaceRef: 'dws_0123456789abcdef01234567',
    objective: 'List the open issues in the "docs" folder.',
    requestedAccess: 'read_only',
    idempotencyKey: KEY,
    ...overrides
  }
}

function item(kind: string, payload: Record<string, unknown>, overrides = {}) {
  return {
    itemId: ITEM_ID,
    kind,
    payload,
    payloadSha256: dotRemotePayloadSha256(payload),
    dependsOnItemId: kind === 'submit' ? null : SUBMIT_ITEM_ID,
    createdAt: T0,
    expiresAt: '2026-10-05T12:30:00.000Z',
    lease: LEASE,
    ...overrides
  }
}

describe('payload hash', () => {
  it('is the sha256 of the UTF-8 canonical JSON of the stored payload', () => {
    const payload = { dotRequestId: REQUEST_ID, contractVersion: 3 }
    const text = `{"contractVersion":3,"dotRequestId":"${REQUEST_ID}"}`
    expect(dotRemoteCanonicalPayload(payload)).toBe(text)
    const expected = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
    expect(dotRemotePayloadSha256(payload)).toBe(expected)
  })

  it('ignores key order and writes non-ASCII text unescaped as UTF-8', () => {
    const left = { text: 'Résumé "東京"', b: 1, a: [2, 1] }
    const right = { a: [2, 1], b: 1, text: 'Résumé "東京"' }
    expect(dotRemoteCanonicalPayload(left)).toBe('{"a":[2,1],"b":1,"text":"Résumé \\"東京\\""}')
    expect(dotRemotePayloadSha256(left)).toBe(dotRemotePayloadSha256(right))
  })
})

describe('inbox payloads are exactly the v3 params', () => {
  it('uses the v3 params schema of each method as the payload', () => {
    expect(DOT_REMOTE_ITEM_KINDS).toEqual([
      'submit',
      'cancel',
      'permission_answer',
      'message',
      'validation_decision'
    ])
    expect(DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS.submit).toBe(DotSubmitParamsV3)
    expect(DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS.cancel).toBe(DotCancelParamsV3)
    expect(DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS.permission_answer).toBe(DotDecisionAnswerParamsV3)
    expect(DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS.message).toBe(DotMessageParamsV3)
    expect(DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS.validation_decision).toBe(DotValidationDecideParamsV3)
    for (const kind of DOT_REMOTE_ITEM_KINDS) {
      expect(DOT_REMOTE_INBOX_ITEM_VARIANTS[kind].shape.payload).toBe(
        DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS[kind]
      )
    }
  })

  it('maps each kind to its v3 method', () => {
    expect(DOT_REMOTE_ITEM_METHODS).toEqual({
      submit: 'dotIngress.requests.submit',
      cancel: 'dotIngress.requests.cancel',
      permission_answer: 'dotIngress.decisions.answer',
      message: 'dotIngress.requests.message',
      validation_decision: 'dotIngress.validations.decide'
    })
  })

  it('injects contractVersion 3 and applies the v3 defaults', () => {
    const input = {
      workspaceRef: 'dws_0123456789abcdef01234567',
      objective: 'Read it.',
      idempotencyKey: KEY
    }
    expect(dotRemoteInboxPayload('submit', input)).toEqual({
      ...input,
      contractVersion: 3,
      requestedAccess: 'read_only'
    })
    expect(() => dotRemoteInboxPayload('submit', { ...input, contractVersion: 1 })).toThrow()
    expect(dotRemoteInboxPayload('cancel', { dotRequestId: REQUEST_ID })).toEqual({
      contractVersion: 3,
      dotRequestId: REQUEST_ID
    })
  })
})

describe('inbox item', () => {
  it('accepts a leased submit item that carries the stored payload and its hash', () => {
    const parsed = DotRemoteInboxItemSchema.parse(item('submit', submitPayload()))
    expect(parsed.payload).toEqual(submitPayload())
    expect(parsed.lease).toEqual(LEASE)
  })

  it('keeps the idempotencyKey of dot and refuses one taken from the item id (RG5)', () => {
    const parsed = DotRemoteInboxItemSchema.parse(item('submit', submitPayload()))
    expect(parsed.kind === 'submit' && parsed.payload.idempotencyKey).toBe(KEY)
    const derived = submitPayload({ idempotencyKey: ITEM_ID })
    expect(DotRemoteInboxItemSchema.safeParse(item('submit', derived)).success).toBe(false)
    const message = {
      contractVersion: 3,
      dotRequestId: REQUEST_ID,
      messageId: ITEM_ID,
      text: 'Hi.'
    }
    expect(DotRemoteInboxItemSchema.safeParse(item('message', message)).success).toBe(false)
  })

  it('refuses a payload whose hash does not match it', () => {
    const tampered = {
      ...item('submit', submitPayload()),
      payload: submitPayload({ objective: 'Other.' })
    }
    expect(DotRemoteInboxItemSchema.safeParse(tampered).success).toBe(false)
  })

  it('refuses a payload of another version or with an unknown key', () => {
    for (const payload of [
      submitPayload({ contractVersion: 1 }),
      submitPayload({ approved: true })
    ]) {
      expect(DotRemoteInboxItemSchema.safeParse(item('submit', payload)).success).toBe(false)
    }
  })

  it('requires a submit to depend on nothing and every other item on its submit', () => {
    const cancel = { contractVersion: 3, dotRequestId: REQUEST_ID }
    expect(DotRemoteInboxItemSchema.safeParse(item('cancel', cancel)).success).toBe(true)
    const orphan = item('cancel', cancel, { dependsOnItemId: null })
    expect(DotRemoteInboxItemSchema.safeParse(orphan).success).toBe(false)
    const dependent = item('submit', submitPayload(), { dependsOnItemId: SUBMIT_ITEM_ID })
    expect(DotRemoteInboxItemSchema.safeParse(dependent).success).toBe(false)
  })

  it('carries a closed lease with nonce, generation and expiry', () => {
    const { lease: _lease, ...noLease } = item('submit', submitPayload())
    expect(DotRemoteInboxItemSchema.safeParse(noLease).success).toBe(false)
    const extra = item('submit', submitPayload(), { lease: { ...LEASE, holder: 'pc' } })
    expect(DotRemoteInboxItemSchema.safeParse(extra).success).toBe(false)
    const unsafeNonce = item('submit', submitPayload(), {
      lease: { ...LEASE, leaseNonce: 'short' }
    })
    expect(DotRemoteInboxItemSchema.safeParse(unsafeNonce).success).toBe(false)
    const generationZero = item('submit', submitPayload(), { lease: { ...LEASE, generation: 0 } })
    expect(DotRemoteInboxItemSchema.safeParse(generationZero).success).toBe(false)
  })

  it('caps one lease response at the per-lease maximum', () => {
    const items = Array.from({ length: DOT_REMOTE_MAX_ITEMS_PER_LEASE + 1 }, () =>
      item('submit', submitPayload())
    )
    const body = { generation: 1, serverTime: T0, items }
    expect(DotRemoteLeaseResponseSchema.safeParse(body).success).toBe(false)
    expect(DotRemoteLeaseResponseSchema.safeParse({ ...body, items: items.slice(1) }).success).toBe(
      true
    )
  })
})

describe('ack from NASH', () => {
  const base = {
    itemId: ITEM_ID,
    leaseNonce: LEASE.leaseNonce,
    generation: 1,
    payloadSha256: 'a'.repeat(64),
    ackedAt: T0
  }

  it('accepts accepted and duplicate with the dotRequestId NASH assigned', () => {
    for (const outcome of ['accepted', 'duplicate']) {
      expect(
        DotRemoteAckRequestSchema.safeParse({ ...base, outcome, dotRequestId: REQUEST_ID }).success
      ).toBe(true)
      expect(DotRemoteAckRequestSchema.safeParse({ ...base, outcome }).success).toBe(false)
    }
    expect(DotRemoteAckRequestSchema.safeParse({ ...base, outcome: 'expired' }).success).toBe(true)
  })

  it('pairs a refusal code with its fixed English message', () => {
    const refusal = {
      by: 'nash',
      code: 'dot_rate_limited',
      message: DOT_INGRESS_ERROR_MESSAGES.dot_rate_limited
    }
    const ack = { ...base, outcome: 'refused', dotRequestId: null, refusal }
    expect(DotRemoteAckRequestSchema.safeParse(ack).success).toBe(true)
    const reworded = { ...ack, refusal: { ...refusal, message: 'Slow down.' } }
    expect(DotRemoteAckRequestSchema.safeParse(reworded).success).toBe(false)
    const unknown = { ...ack, refusal: { ...refusal, code: 'internal_error' } }
    expect(DotRemoteAckRequestSchema.safeParse(unknown).success).toBe(false)
  })

  it('covers every v3 error code with its v3 message', () => {
    for (const code of DOT_INGRESS_ERROR_CODES_V3) {
      const refusal = dotRemoteNashRefusal(code)
      expect(refusal).toEqual({ by: 'nash', code, message: dotIngressErrorMessageV3(code) })
      expect(DotRemoteNashRefusalSchema.safeParse(refusal).success).toBe(true)
    }
  })

  it('refuses an ack that names no lease or carries an unknown key', () => {
    const { leaseNonce: _nonce, ...noNonce } = { ...base, outcome: 'expired' }
    expect(DotRemoteAckRequestSchema.safeParse(noNonce).success).toBe(false)
    const extra = { ...base, outcome: 'expired', sessionToken: 'x' }
    expect(DotRemoteAckRequestSchema.safeParse(extra).success).toBe(false)
  })
})

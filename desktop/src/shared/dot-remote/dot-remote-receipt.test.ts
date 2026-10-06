import { describe, expect, it } from 'vitest'
import { dotRemoteNashRefusal, dotRemoteSiteRefusal } from './dot-remote-errors'
import {
  DOT_REMOTE_RECEIPT_STATES,
  DotRemoteAnswerReceiptSchema,
  DotRemoteCancelReceiptSchema,
  DotRemoteMessageReceiptSchema,
  DotRemoteReceiptSchema,
  DotRemoteSubmitReceiptSchema
} from './dot-remote-receipt'
import { DotRemoteCancelOutputSchema } from './dot-remote-tool-views'

const SUBMIT_ID = '10000000-0000-4000-8000-000000000001'
const CANCEL_ID = '10000000-0000-4000-8000-000000000002'
const REQUEST_ID = '30000000-0000-4000-8000-000000000001'
const HASH = 'b'.repeat(64)
const T0 = '2026-10-05T12:00:00.000Z'

function submitReceipt(state: string, overrides: Record<string, unknown> = {}) {
  return {
    itemId: SUBMIT_ID,
    kind: 'submit',
    state,
    payloadSha256: HASH,
    dependsOnItemId: null,
    dotRequestId: null,
    createdAt: T0,
    expiresAt: '2026-10-05T12:30:00.000Z',
    updatedAt: T0,
    ...overrides
  }
}

function cancelReceipt(state: string, overrides: Record<string, unknown> = {}) {
  return {
    ...submitReceipt(state),
    itemId: CANCEL_ID,
    kind: 'cancel',
    dependsOnItemId: SUBMIT_ID,
    dotRequestId: REQUEST_ID,
    ...overrides
  }
}

describe('hosted receipt (RG6)', () => {
  it('has exactly the six receipt states', () => {
    expect(DOT_REMOTE_RECEIPT_STATES).toEqual([
      'queued',
      'claimed',
      'accepted',
      'refused',
      'expired',
      'canceled_before_claim'
    ])
  })

  it('exists with its itemId before NASH assigns a dotRequestId', () => {
    expect(DotRemoteSubmitReceiptSchema.safeParse(submitReceipt('queued')).success).toBe(true)
    expect(DotRemoteSubmitReceiptSchema.safeParse(submitReceipt('claimed')).success).toBe(true)
    const early = submitReceipt('queued', { dotRequestId: REQUEST_ID })
    expect(DotRemoteSubmitReceiptSchema.safeParse(early).success).toBe(false)
  })

  it('names the dotRequestId of NASH once accepted', () => {
    const accepted = submitReceipt('accepted', { dotRequestId: REQUEST_ID, duplicate: false })
    expect(DotRemoteSubmitReceiptSchema.safeParse(accepted).success).toBe(true)
    const missing = submitReceipt('accepted', { duplicate: false })
    expect(DotRemoteSubmitReceiptSchema.safeParse(missing).success).toBe(false)
  })

  it('cancels before claim only a submit', () => {
    expect(
      DotRemoteSubmitReceiptSchema.safeParse(submitReceipt('canceled_before_claim')).success
    ).toBe(true)
    expect(
      DotRemoteCancelReceiptSchema.safeParse(cancelReceipt('canceled_before_claim')).success
    ).toBe(false)
  })

  it('carries either a NASH refusal or a Site refusal when refused', () => {
    const byNash = submitReceipt('refused', { refusal: dotRemoteNashRefusal('dot_rate_limited') })
    expect(DotRemoteSubmitReceiptSchema.safeParse(byNash).success).toBe(true)
    const bySite = cancelReceipt('refused', {
      dotRequestId: null,
      payloadSha256: null,
      refusal: dotRemoteSiteRefusal('cancel_target_not_admitted')
    })
    expect(DotRemoteCancelReceiptSchema.safeParse(bySite).success).toBe(true)
    const bare = submitReceipt('refused')
    expect(DotRemoteSubmitReceiptSchema.safeParse(bare).success).toBe(false)
  })

  it('holds a cancel without payload until the admission mapping names the request', () => {
    const waiting = cancelReceipt('queued', { dotRequestId: null, payloadSha256: null })
    expect(DotRemoteCancelReceiptSchema.safeParse(waiting).success).toBe(true)
    const half = cancelReceipt('queued', { dotRequestId: null })
    expect(DotRemoteCancelReceiptSchema.safeParse(half).success).toBe(false)
    expect(DotRemoteCancelReceiptSchema.safeParse(cancelReceipt('queued')).success).toBe(true)
  })

  it('depends on the submit for every item but a submit', () => {
    const answer = { ...cancelReceipt('queued'), kind: 'permission_answer' }
    expect(DotRemoteAnswerReceiptSchema.safeParse(answer).success).toBe(true)
    expect(
      DotRemoteAnswerReceiptSchema.safeParse({ ...answer, dependsOnItemId: null }).success
    ).toBe(false)
    const message = { ...cancelReceipt('queued'), kind: 'message', dotRequestId: null }
    expect(DotRemoteMessageReceiptSchema.safeParse(message).success).toBe(false)
  })

  it('accepts any of the four kinds through the general receipt and refuses unknown keys', () => {
    expect(DotRemoteReceiptSchema.safeParse(submitReceipt('queued')).success).toBe(true)
    expect(DotRemoteReceiptSchema.safeParse(cancelReceipt('queued')).success).toBe(true)
    const extra = submitReceipt('queued', { objective: 'x' })
    expect(DotRemoteReceiptSchema.safeParse(extra).success).toBe(false)
  })
})

describe('queued cancel', () => {
  it('cancels a queued submit on the Site and creates no cancel item', () => {
    const output = {
      outcome: 'canceled_before_claim',
      target: submitReceipt('canceled_before_claim'),
      cancel: null
    }
    expect(DotRemoteCancelOutputSchema.safeParse(output).success).toBe(true)
    const withItem = { ...output, cancel: cancelReceipt('queued') }
    expect(DotRemoteCancelOutputSchema.safeParse(withItem).success).toBe(false)
  })

  it('forwards a cancel for a claimed or accepted submit through the admission mapping', () => {
    const claimed = {
      outcome: 'forwarded',
      target: submitReceipt('claimed'),
      cancel: cancelReceipt('queued', { dotRequestId: null, payloadSha256: null })
    }
    expect(DotRemoteCancelOutputSchema.safeParse(claimed).success).toBe(true)
    const accepted = {
      outcome: 'forwarded',
      target: submitReceipt('accepted', { dotRequestId: REQUEST_ID, duplicate: false }),
      cancel: cancelReceipt('queued')
    }
    expect(DotRemoteCancelOutputSchema.safeParse(accepted).success).toBe(true)
    const queued = { ...claimed, target: submitReceipt('queued') }
    expect(DotRemoteCancelOutputSchema.safeParse(queued).success).toBe(false)
  })

  it('reports nothing to cancel for a refused or expired submit', () => {
    const refused = submitReceipt('refused', { refusal: dotRemoteNashRefusal('dot_rate_limited') })
    for (const target of [refused, submitReceipt('expired')]) {
      const output = { outcome: 'nothing_to_cancel', target, cancel: null }
      expect(DotRemoteCancelOutputSchema.safeParse(output).success).toBe(true)
    }
  })
})

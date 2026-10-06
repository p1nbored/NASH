import { z } from 'zod'
import { DotRequestIdSchema } from '../dot-ingress/dot-ingress-params'
import { DotRemoteReceiptRefusalSchema } from './dot-remote-errors'
import {
  DotRemoteItemIdSchema,
  DotRemoteSha256Schema,
  DotRemoteTimestampSchema
} from './dot-remote-primitives'

// RG6: a receipt is the Site's record of one inbox item. It exists, with its itemId, before NASH
// assigns a dotRequestId. NASH alone moves it to accepted or refused through its ack; the Site moves
// it only to claimed, expired, canceled_before_claim (a queued submit) or a Site refusal.

export const DOT_REMOTE_RECEIPT_STATES = [
  'queued',
  'claimed',
  'accepted',
  'refused',
  'expired',
  'canceled_before_claim'
] as const

type ReceiptSpec = {
  kind: z.ZodType
  dependsOnItemId: z.ZodType
  /** The request this item created or targets, while NASH has not accepted it. */
  pendingRequestId: z.ZodType
  payloadSha256: z.ZodType
}

function receiptVariants(spec: ReceiptSpec) {
  const fields = {
    itemId: DotRemoteItemIdSchema,
    kind: spec.kind,
    payloadSha256: spec.payloadSha256,
    dependsOnItemId: spec.dependsOnItemId,
    dotRequestId: spec.pendingRequestId,
    createdAt: DotRemoteTimestampSchema,
    expiresAt: DotRemoteTimestampSchema,
    updatedAt: DotRemoteTimestampSchema
  }
  return {
    queued: z.object({ ...fields, state: z.literal('queued') }).strict(),
    claimed: z.object({ ...fields, state: z.literal('claimed') }).strict(),
    accepted: z
      .object({
        ...fields,
        state: z.literal('accepted'),
        payloadSha256: DotRemoteSha256Schema,
        dotRequestId: DotRequestIdSchema,
        /** True when NASH reported the item as already admitted before. */
        duplicate: z.boolean()
      })
      .strict(),
    refused: z
      .object({ ...fields, state: z.literal('refused'), refusal: DotRemoteReceiptRefusalSchema })
      .strict(),
    expired: z.object({ ...fields, state: z.literal('expired') }).strict()
  }
}

const submitVariants = receiptVariants({
  kind: z.literal('submit'),
  dependsOnItemId: z.null(),
  pendingRequestId: z.null(),
  payloadSha256: DotRemoteSha256Schema
})

export const DOT_REMOTE_SUBMIT_RECEIPT_VARIANTS = {
  ...submitVariants,
  canceled_before_claim: submitVariants.expired.extend({
    state: z.literal('canceled_before_claim')
  })
}

export const DotRemoteSubmitReceiptSchema = z.discriminatedUnion('state', [
  DOT_REMOTE_SUBMIT_RECEIPT_VARIANTS.queued,
  DOT_REMOTE_SUBMIT_RECEIPT_VARIANTS.claimed,
  DOT_REMOTE_SUBMIT_RECEIPT_VARIANTS.accepted,
  DOT_REMOTE_SUBMIT_RECEIPT_VARIANTS.refused,
  DOT_REMOTE_SUBMIT_RECEIPT_VARIANTS.expired,
  DOT_REMOTE_SUBMIT_RECEIPT_VARIANTS.canceled_before_claim
])

function controlReceipt(spec: ReceiptSpec) {
  const variants = receiptVariants(spec)
  return z.discriminatedUnion('state', [
    variants.queued,
    variants.claimed,
    variants.accepted,
    variants.refused,
    variants.expired
  ])
}

const DependsOnSubmit = DotRemoteItemIdSchema

/** A cancel for a claimed submit waits, with no payload yet, until the submit's ack names the request. */
export const DotRemoteCancelReceiptSchema = controlReceipt({
  kind: z.literal('cancel'),
  dependsOnItemId: DependsOnSubmit,
  pendingRequestId: DotRequestIdSchema.nullable(),
  payloadSha256: DotRemoteSha256Schema.nullable()
}).superRefine((receipt, context) => {
  if ((receipt.dotRequestId === null) !== (receipt.payloadSha256 === null)) {
    context.addIssue({
      code: 'custom',
      message: 'A cancel has a payload exactly when its request is known',
      path: ['payloadSha256']
    })
  }
})

export const DotRemoteAnswerReceiptSchema = controlReceipt({
  kind: z.literal('permission_answer'),
  dependsOnItemId: DependsOnSubmit,
  pendingRequestId: DotRequestIdSchema,
  payloadSha256: DotRemoteSha256Schema
})

export const DotRemoteMessageReceiptSchema = controlReceipt({
  kind: z.literal('message'),
  dependsOnItemId: DependsOnSubmit,
  pendingRequestId: DotRequestIdSchema,
  payloadSha256: DotRemoteSha256Schema
})

/** A waive or reject of a validation the Site holds as open; its request comes from the pending event. */
export const DotRemoteValidationDecisionReceiptSchema = controlReceipt({
  kind: z.literal('validation_decision'),
  dependsOnItemId: DependsOnSubmit,
  pendingRequestId: DotRequestIdSchema,
  payloadSha256: DotRemoteSha256Schema
})

export const DotRemoteReceiptSchema = z.union([
  DotRemoteSubmitReceiptSchema,
  DotRemoteCancelReceiptSchema,
  DotRemoteAnswerReceiptSchema,
  DotRemoteMessageReceiptSchema,
  DotRemoteValidationDecisionReceiptSchema
])

export type DotRemoteReceipt = z.infer<typeof DotRemoteReceiptSchema>

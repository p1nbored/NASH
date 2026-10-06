import { z } from 'zod'
import { DotRequestIdSchema } from '../dot-ingress/dot-ingress-params'
import { DotRemoteNashRefusalSchema } from './dot-remote-errors'
import {
  DotRemoteGenerationSchema,
  DotRemoteItemIdSchema,
  DotRemoteLeaseNonceSchema,
  DotRemoteSha256Schema,
  DotRemoteTimestampSchema
} from './dot-remote-primitives'
import { DOT_REMOTE_RECEIPT_STATES } from './dot-remote-receipt'

// NASH answers each leased item once it has a final local outcome. The lease nonce, generation and
// payload hash fence the ack: a stale lease, an old pairing or another payload is refused.

export const DOT_REMOTE_ACK_OUTCOMES = ['accepted', 'duplicate', 'refused', 'expired'] as const

const ackFields = {
  itemId: DotRemoteItemIdSchema,
  leaseNonce: DotRemoteLeaseNonceSchema,
  generation: DotRemoteGenerationSchema,
  payloadSha256: DotRemoteSha256Schema,
  ackedAt: DotRemoteTimestampSchema
}

export const DotRemoteAckRequestSchema = z.discriminatedUnion('outcome', [
  /** NASH admitted the item; for a submit this is the request it created. */
  z
    .object({ ...ackFields, outcome: z.literal('accepted'), dotRequestId: DotRequestIdSchema })
    .strict(),
  /** NASH had already admitted this item; its own idempotency ledger returned the first result. */
  z
    .object({ ...ackFields, outcome: z.literal('duplicate'), dotRequestId: DotRequestIdSchema })
    .strict(),
  z
    .object({
      ...ackFields,
      outcome: z.literal('refused'),
      dotRequestId: DotRequestIdSchema.nullable(),
      refusal: DotRemoteNashRefusalSchema
    })
    .strict(),
  /** NASH saw expiresAt already passed and did not act on the item. */
  z.object({ ...ackFields, outcome: z.literal('expired') }).strict()
])

export const DotRemoteAckResponseSchema = z
  .object({
    itemId: DotRemoteItemIdSchema,
    recorded: z.enum(['applied', 'already_recorded']),
    receiptState: z.enum(DOT_REMOTE_RECEIPT_STATES)
  })
  .strict()

export type DotRemoteAckRequest = z.infer<typeof DotRemoteAckRequestSchema>

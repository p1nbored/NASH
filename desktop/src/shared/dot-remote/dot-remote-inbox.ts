import { z } from 'zod'
import { DOT_REMOTE_MAX_ITEMS_PER_LEASE } from './dot-remote-limits'
import { DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS, dotRemotePayloadSha256 } from './dot-remote-payload'
import {
  DotRemoteGenerationSchema,
  DotRemoteItemIdSchema,
  DotRemoteLeaseNonceSchema,
  DotRemoteSha256Schema,
  DotRemoteTimestampSchema
} from './dot-remote-primitives'

// RG5: delivery is at least once. The Site leases items oldest first to the one paired device;
// every lease carries its own nonce, the pairing generation and an expiry, and an unacked lease
// returns the item to the queue. NASH re-checks every item with its own contract checks.

export const DotRemoteLeaseSchema = z
  .object({
    leaseNonce: DotRemoteLeaseNonceSchema,
    generation: DotRemoteGenerationSchema,
    leaseExpiresAt: DotRemoteTimestampSchema
  })
  .strict()

const itemFields = {
  itemId: DotRemoteItemIdSchema,
  payloadSha256: DotRemoteSha256Schema,
  createdAt: DotRemoteTimestampSchema,
  expiresAt: DotRemoteTimestampSchema,
  lease: DotRemoteLeaseSchema
}
/** Every item but a submit follows the submit whose admission named its request. */
const DependsOnSubmit = DotRemoteItemIdSchema.describe('The submit item this item follows')

export const DOT_REMOTE_INBOX_ITEM_VARIANTS = {
  submit: z
    .object({
      ...itemFields,
      kind: z.literal('submit'),
      dependsOnItemId: z.null(),
      payload: DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS.submit
    })
    .strict(),
  cancel: z
    .object({
      ...itemFields,
      kind: z.literal('cancel'),
      dependsOnItemId: DependsOnSubmit,
      payload: DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS.cancel
    })
    .strict(),
  permission_answer: z
    .object({
      ...itemFields,
      kind: z.literal('permission_answer'),
      dependsOnItemId: DependsOnSubmit,
      payload: DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS.permission_answer
    })
    .strict(),
  message: z
    .object({
      ...itemFields,
      kind: z.literal('message'),
      dependsOnItemId: DependsOnSubmit,
      payload: DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS.message
    })
    .strict(),
  validation_decision: z
    .object({
      ...itemFields,
      kind: z.literal('validation_decision'),
      dependsOnItemId: DependsOnSubmit,
      payload: DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS.validation_decision
    })
    .strict()
} as const

export const DotRemoteInboxItemSchema = z
  .discriminatedUnion('kind', [
    DOT_REMOTE_INBOX_ITEM_VARIANTS.submit,
    DOT_REMOTE_INBOX_ITEM_VARIANTS.cancel,
    DOT_REMOTE_INBOX_ITEM_VARIANTS.permission_answer,
    DOT_REMOTE_INBOX_ITEM_VARIANTS.message,
    DOT_REMOTE_INBOX_ITEM_VARIANTS.validation_decision
  ])
  .superRefine((item, context) => {
    if (dotRemotePayloadSha256(item.payload) !== item.payloadSha256) {
      context.addIssue({
        code: 'custom',
        message: 'payloadSha256 does not match the payload',
        path: ['payloadSha256']
      })
    }
    // RG5: the contract key is the one dot chose; the Site never derives it from its own item id.
    const contractKey =
      item.kind === 'submit'
        ? item.payload.idempotencyKey
        : item.kind === 'message'
          ? item.payload.messageId
          : item.kind === 'validation_decision'
            ? item.payload.decisionId
            : null
    if (contractKey === item.itemId) {
      context.addIssue({
        code: 'custom',
        message: 'The contract key must not be the item id',
        path: ['payload']
      })
    }
  })

export const DotRemoteLeaseRequestSchema = z
  .object({
    generation: DotRemoteGenerationSchema,
    maxItems: z.number().int().min(1).max(DOT_REMOTE_MAX_ITEMS_PER_LEASE)
  })
  .strict()

export const DotRemoteLeaseResponseSchema = z
  .object({
    generation: DotRemoteGenerationSchema,
    serverTime: DotRemoteTimestampSchema,
    items: z.array(DotRemoteInboxItemSchema).max(DOT_REMOTE_MAX_ITEMS_PER_LEASE)
  })
  .strict()

/** Extends a lease NASH still holds while it is processing the item. */
export const DotRemoteLeaseRenewRequestSchema = z
  .object({
    itemId: DotRemoteItemIdSchema,
    leaseNonce: DotRemoteLeaseNonceSchema,
    generation: DotRemoteGenerationSchema
  })
  .strict()

export const DotRemoteLeaseRenewResponseSchema = z
  .object({
    itemId: DotRemoteItemIdSchema,
    leaseNonce: DotRemoteLeaseNonceSchema,
    leaseExpiresAt: DotRemoteTimestampSchema
  })
  .strict()

export type DotRemoteInboxItem = z.infer<typeof DotRemoteInboxItemSchema>

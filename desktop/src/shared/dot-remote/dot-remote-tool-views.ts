import { z } from 'zod'
import {
  DotRequestAccessSchema,
  DotRequestIdSchema,
  DotWorkspaceRefSchema
} from '../dot-ingress/dot-ingress-params'
import { DotValidationViewSchema } from '../dot-ingress/dot-ingress-validation'
import { DOT_REMOTE_EVENT_VARIANTS, DotRemotePromptOpenedDataSchema } from './dot-remote-events'
import { WORKBENCH_LIST_MAX_LIMIT } from '../workbench-request'
import { DOT_REMOTE_LIST_MAX_LIMIT, DOT_REMOTE_PROJECTION_LIST_MAX } from './dot-remote-limits'
import { DotRemoteCursorSchema, DotRemoteItemIdSchema } from './dot-remote-primitives'
import {
  DOT_REMOTE_SUBMIT_RECEIPT_VARIANTS,
  DotRemoteCancelReceiptSchema,
  DotRemoteSubmitReceiptSchema
} from './dot-remote-receipt'

// Read views dot gets from the Site. Each is a fold of what NASH reported: the newest event per
// subject, never a status the Site worked out itself (NASH stays the single authority).

const ProjectionList = <Item extends z.ZodType>(item: Item) =>
  z.array(item).max(DOT_REMOTE_PROJECTION_LIST_MAX)

/** One request as NASH last reported it, in increasing sourceRevision within each list. */
export const DotRemoteRequestProjectionSchema = z
  .object({
    dotRequestId: DotRequestIdSchema,
    submitItemId: DotRemoteItemIdSchema,
    workspaceRef: DotWorkspaceRefSchema,
    requestedAccess: DotRequestAccessSchema,
    /** The highest sourceRevision applied for this request; 0 before any event. */
    appliedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    status: DOT_REMOTE_EVENT_VARIANTS.request_status.nullable(),
    /** The newest event per decisionId: an opened prompt, or the closed event that replaced it. */
    prompts: ProjectionList(
      z.union([
        DOT_REMOTE_EVENT_VARIANTS.permission_prompt_opened,
        DOT_REMOTE_EVENT_VARIANTS.permission_prompt_closed
      ])
    ),
    /** The newest event per messageId. */
    messageOutcomes: ProjectionList(DOT_REMOTE_EVENT_VARIANTS.message_outcome),
    validationResults: ProjectionList(DOT_REMOTE_EVENT_VARIANTS.validation_result),
    deliverable: DOT_REMOTE_EVENT_VARIANTS.deliverable_summary.nullable(),
    /** The newest event per validationId; empty for a request stored before contract version 3. */
    validationDecisions: ProjectionList(
      z.union([
        DOT_REMOTE_EVENT_VARIANTS.validation_decision_pending,
        DOT_REMOTE_EVENT_VARIANTS.validation_decision_settled
      ])
    )
  })
  .strict()

export const DotRemoteRequestListOutputSchema = z
  .object({
    requests: z
      .array(
        z
          .object({
            receipt: DotRemoteSubmitReceiptSchema,
            status: DOT_REMOTE_EVENT_VARIANTS.request_status.nullable()
          })
          .strict()
      )
      .max(DOT_REMOTE_LIST_MAX_LIMIT),
    nextCursor: DotRemoteCursorSchema.nullable()
  })
  .strict()

/** Open prompts only: pending and before their deadline; the limit is the ingress list limit. */
export const DotRemotePromptListOutputSchema = z
  .object({ decisions: z.array(DotRemotePromptOpenedDataSchema).max(WORKBENCH_LIST_MAX_LIMIT) })
  .strict()

/** Open validation decisions, oldest first by createdAt and then validationId. */
export const DotRemoteValidationListOutputSchema = z
  .object({
    validations: z.array(DotValidationViewSchema).max(DOT_REMOTE_LIST_MAX_LIMIT),
    nextCursor: DotRemoteCursorSchema.nullable()
  })
  .strict()

const SUBMIT = DOT_REMOTE_SUBMIT_RECEIPT_VARIANTS

/**
 * RG6 queued cancel: a queued submit is canceled on the Site in one transaction and nothing reaches
 * NASH. A claimed or accepted submit gets a cancel item that resolves through the admission mapping.
 */
export const DotRemoteCancelOutputSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('canceled_before_claim'),
      target: SUBMIT.canceled_before_claim,
      cancel: z.null()
    })
    .strict(),
  // Why refused and expired too: a repeated call returns the current state after the submit's ack.
  z
    .object({
      outcome: z.literal('forwarded'),
      target: z.discriminatedUnion('state', [
        SUBMIT.claimed,
        SUBMIT.accepted,
        SUBMIT.refused,
        SUBMIT.expired
      ]),
      cancel: DotRemoteCancelReceiptSchema
    })
    .strict(),
  z
    .object({
      outcome: z.literal('nothing_to_cancel'),
      target: z.discriminatedUnion('state', [SUBMIT.refused, SUBMIT.expired]),
      cancel: z.null()
    })
    .strict()
])

import { z } from 'zod'
import { DeliverableLanguageSchema } from '../deliverable-language'
import {
  WORKBENCH_LIST_DEFAULT_LIMIT,
  WORKBENCH_LIST_MAX_LIMIT,
  WorkbenchObjectiveSchema,
  WorkbenchPositiveIntegerSchema
} from '../workbench-request'
import {
  DOT_CORRELATION_ID_MAX_CHARS,
  DOT_DEFAULT_REQUEST_ACCESS,
  DOT_INGRESS_CONTRACT_VERSION,
  DOT_REQUEST_ACCESS_LEVELS
} from './dot-ingress-limits'

// Every schema is strict and has no approval, permission, route, profile, surface, data-class,
// principal, source or path field: a relayed "the user approved" is only text. The one authority-like
// field is requestedAccess, which the dot states itself (user decision 2026-10-05) and which is
// recorded as given.

const ContractVersionSchema = z.literal(DOT_INGRESS_CONTRACT_VERSION)

/** Claimed by the sender, stored as untrusted display data and never used as authority. */
export const DotClientDescriptorSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    version: z.string().regex(/^[A-Za-z0-9._+-]{1,32}$/)
  })
  .strict()

/** Opaque, random and free of path material; the desktop maps it back to a workspace. */
export const DotWorkspaceRefSchema = z.string().regex(/^dws_[0-9a-f]{24}$/)

export const DotCorrelationIdSchema = z
  .string()
  .regex(new RegExp(`^[A-Za-z0-9._:/=+-]{1,${DOT_CORRELATION_ID_MAX_CHARS}}$`))

/** Stored and echoed, never interpreted. */
export const DotReplyMetadataSchema = z
  .object({ correlationId: DotCorrelationIdSchema.optional() })
  .strict()

export const DotRequestIdSchema = z.uuid()
export const DotDecisionIdSchema = z.uuid()
export const DotRequestAccessSchema = z.enum(DOT_REQUEST_ACCESS_LEVELS)

const limitField = z
  .number()
  .int()
  .min(1)
  .max(WORKBENCH_LIST_MAX_LIMIT)
  .default(WORKBENCH_LIST_DEFAULT_LIMIT)

export const DotHelloParams = z
  .object({ contractVersion: ContractVersionSchema, client: DotClientDescriptorSchema.optional() })
  .strict()

export const DotWorkspacesParams = z.object({ contractVersion: ContractVersionSchema }).strict()

/**
 * The objective is English prose; names, paths and quotations that must not be translated sit in
 * quoted spans. requestedAccess defaults to read_only and is never upgraded.
 */
export const DotSubmitParams = z
  .object({
    contractVersion: ContractVersionSchema,
    workspaceRef: DotWorkspaceRefSchema,
    objective: WorkbenchObjectiveSchema,
    requestedAccess: DotRequestAccessSchema.default(DOT_DEFAULT_REQUEST_ACCESS),
    deliverableLanguage: DeliverableLanguageSchema.optional(),
    idempotencyKey: z.uuid(),
    reply: DotReplyMetadataSchema.optional(),
    client: DotClientDescriptorSchema.optional()
  })
  .strict()

export const DotStatusParams = z
  .object({ contractVersion: ContractVersionSchema, dotRequestId: DotRequestIdSchema })
  .strict()

export const DotListParams = z
  .object({
    contractVersion: ContractVersionSchema,
    limit: limitField,
    beforeSequence: WorkbenchPositiveIntegerSchema.optional()
  })
  .strict()

/** Cancels a request the dot submitted; the service stops its Workbench request and run first. */
export const DotCancelParams = z
  .object({ contractVersion: ContractVersionSchema, dotRequestId: DotRequestIdSchema })
  .strict()

/** Pending prompts only, optionally for one request of the dot. */
export const DotDecisionsListParams = z
  .object({
    contractVersion: ContractVersionSchema,
    dotRequestId: DotRequestIdSchema.optional(),
    limit: limitField
  })
  .strict()

/** The first answer wins; there is no reason text, rule or updated permission to widen access. */
export const DotDecisionAnswerParams = z
  .object({
    contractVersion: ContractVersionSchema,
    decisionId: DotDecisionIdSchema,
    decision: z.enum(['allow', 'deny'])
  })
  .strict()

export type DotHelloInput = z.infer<typeof DotHelloParams>
export type DotWorkspacesInput = z.infer<typeof DotWorkspacesParams>
export type DotSubmitInput = z.infer<typeof DotSubmitParams>
export type DotStatusInput = z.infer<typeof DotStatusParams>
export type DotListInput = z.infer<typeof DotListParams>
export type DotCancelInput = z.infer<typeof DotCancelParams>
export type DotDecisionsListInput = z.infer<typeof DotDecisionsListParams>
export type DotDecisionAnswerInput = z.infer<typeof DotDecisionAnswerParams>
export type DotClientDescriptor = z.infer<typeof DotClientDescriptorSchema>

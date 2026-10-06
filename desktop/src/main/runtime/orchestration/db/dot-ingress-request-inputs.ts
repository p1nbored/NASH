import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  canonicalizeDeliverableLanguage,
  DeliverableLanguageSchema
} from '../../../../shared/deliverable-language'
import {
  DOT_INGRESS_CONTRACT_VERSION,
  DOT_INGRESS_SCAN_RULE_MAX_COUNT,
  DOT_SUBMISSION_FAILURES
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import {
  DotClientDescriptorSchema,
  DotCorrelationIdSchema,
  DotRequestAccessSchema,
  DotRequestIdSchema,
  DotWorkspaceRefSchema
} from '../../../../shared/dot-ingress/dot-ingress-params'
import { splitVerbatimSpans } from '../../../../shared/verbatim-spans'
import {
  WORKBENCH_LIST_MAX_LIMIT,
  WorkbenchObjectiveSchema,
  WorkbenchPositiveIntegerSchema,
  WorkbenchRequestIdSchema
} from '../../../../shared/workbench-request'
import { hasSecretLikeText } from '../../../agent-exec-shared/secret-shapes'
import { Sha256HexSchema, UtcTimestampSchema } from './autopilot-store-input'
import { dotIngressError } from './dot-ingress-store-input'

/** Rule names only, so matched text can never be stored with a request. */
const ScanRuleNameSchema = z.string().regex(/^[a-z0-9_:.-]{1,64}$/)

/** The service canonicalizes the tag, so the stored form and the hashed form are one. */
const CanonicalLanguageSchema = DeliverableLanguageSchema.refine((tag) => {
  const canonical = canonicalizeDeliverableLanguage(tag)
  return canonical.ok && canonical.tag === tag
}, 'Deliverable language must be in canonical form')

export const DotIngressSubmitInputSchema = z
  .object({
    workspaceRef: DotWorkspaceRefSchema,
    /** The binding the service just re-admitted; it must equal the one the user enabled. */
    workspaceBinding: Sha256HexSchema,
    objective: WorkbenchObjectiveSchema,
    /** Recorded as the dot stated it; the store never raises it. */
    requestedAccess: DotRequestAccessSchema,
    deliverableLanguage: CanonicalLanguageSchema.nullable(),
    idempotencyKey: z.uuid(),
    replyCorrelationId: DotCorrelationIdSchema.nullable(),
    client: DotClientDescriptorSchema.nullable(),
    scanRules: z.array(ScanRuleNameSchema).max(DOT_INGRESS_SCAN_RULE_MAX_COUNT),
    timestamp: UtcTimestampSchema
  })
  .strict()
export type DotIngressSubmitInput = z.infer<typeof DotIngressSubmitInputSchema>

export function dotIngressRequestHash(input: DotIngressSubmitInput): string {
  // Why: the claimed client is display data, not part of the request bytes, so it is not hashed.
  return createHash('sha256')
    .update(
      JSON.stringify({
        contractVersion: DOT_INGRESS_CONTRACT_VERSION,
        workspaceRef: input.workspaceRef,
        workspaceBinding: input.workspaceBinding,
        objective: input.objective,
        requestedAccess: input.requestedAccess,
        deliverableLanguage: input.deliverableLanguage,
        replyCorrelationId: input.replyCorrelationId
      })
    )
    .digest('hex')
}

/** The analysis already ran; this is the last gate before anything is stored or handed to an agent. */
export function requireStorableObjective(objective: string): void {
  if (!splitVerbatimSpans(objective).ok) {
    throw dotIngressError('dot_requirement_too_long')
  }
  // Why: a credential is refused anywhere, including quoted spans, so none is ever persisted.
  if (hasSecretLikeText(objective)) {
    throw dotIngressError('dot_requirement_rejected_content')
  }
}

/** Computed from the bytes being stored, so no caller can state a count. */
export function countQuotedSpans(objective: string): number {
  const split = splitVerbatimSpans(objective)
  return split.ok ? split.spans.length : 0
}

export const DotCancelInputSchema = z
  .object({ dotRequestId: DotRequestIdSchema, timestamp: UtcTimestampSchema })
  .strict()
export const DotListInputSchema = z
  .object({
    limit: z.number().int().min(1).max(WORKBENCH_LIST_MAX_LIMIT),
    beforeSequence: WorkbenchPositiveIntegerSchema.optional()
  })
  .strict()
export const DotLinkInputSchema = z
  .object({
    dotRequestId: DotRequestIdSchema,
    workbenchRequestId: WorkbenchRequestIdSchema,
    timestamp: UtcTimestampSchema
  })
  .strict()
export const DotFailInputSchema = z
  .object({
    dotRequestId: DotRequestIdSchema,
    failure: z.enum(DOT_SUBMISSION_FAILURES),
    timestamp: UtcTimestampSchema
  })
  .strict()
export const DotRecoveryLimitSchema = z.number().int().min(1).max(WORKBENCH_LIST_MAX_LIMIT)

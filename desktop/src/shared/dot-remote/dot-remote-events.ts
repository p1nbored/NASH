import { z } from 'zod'
import { DOT_MESSAGE_OUTCOMES, DOT_MESSAGE_REASONS } from '../dot-ingress/dot-ingress-message'
import { DotRequestIdSchema } from '../dot-ingress/dot-ingress-params'
import { DotDecisionViewSchema } from '../dot-ingress/dot-ingress-decision'
import { DotRequestViewSchema } from '../dot-ingress/dot-ingress-request'
import {
  DotValidationSettledSchema,
  DotValidationViewSchema
} from '../dot-ingress/dot-ingress-validation'
import {
  DOT_REMOTE_ARTIFACT_MAX,
  DOT_REMOTE_DELIVERABLE_SUMMARY_MAX_CHARS,
  DOT_REMOTE_EVENT_BATCH_MAX,
  DOT_REMOTE_VALIDATION_LINE_MAX_CHARS
} from './dot-remote-limits'
import {
  DotRemoteArtifactIdSchema,
  DotRemoteEventIdSchema,
  DotRemoteGenerationSchema,
  DotRemoteSha256Schema,
  DotRemoteSourceRevisionSchema,
  DotRemoteTimestampSchema,
  dotRemoteEnglishLine
} from './dot-remote-primitives'

// RG6: the only facts NASH reports to the Site. Each kind has its own closed schema; there is no
// generic data field, and no raw tool input, terminal or executor output, database row, error stack,
// path or file content can be expressed. NASH persists an event locally before it sends it.

export const DOT_REMOTE_EVENT_KINDS = [
  'request_status',
  'permission_prompt_opened',
  'permission_prompt_closed',
  'message_outcome',
  'validation_result',
  'deliverable_summary',
  'validation_decision_pending',
  'validation_decision_settled'
] as const
export type DotRemoteEventKind = (typeof DOT_REMOTE_EVENT_KINDS)[number]

const COARSE_VIEW = { state: true, statusText: true, run: true } as const
const [ReceivedView, SubmittedView, CanceledView, FailedView] = DotRequestViewSchema.options

/** The coarse run projection only: request state, its fixed English text and the coarse run view. */
export const DotRemoteRequestStatusDataSchema = z.discriminatedUnion('state', [
  ReceivedView.pick(COARSE_VIEW),
  SubmittedView.pick(COARSE_VIEW),
  CanceledView.pick(COARSE_VIEW),
  FailedView.pick(COARSE_VIEW)
])

/** The decision view: names only, secrets masked, one line of at most 500 characters (D-017). */
export const DotRemotePromptOpenedDataSchema = DotDecisionViewSchema.safeExtend({
  status: z.literal('pending')
})
export const DotRemotePromptClosedDataSchema = DotDecisionViewSchema.safeExtend({
  status: z.enum(['allowed', 'denied', 'answered_in_terminal', 'expired'])
})

export const DotRemoteMessageOutcomeDataSchema = z
  .object({
    messageId: z.uuid(),
    outcome: z.enum(DOT_MESSAGE_OUTCOMES),
    reason: z.enum(DOT_MESSAGE_REASONS).nullable()
  })
  .strict()
  .refine((data) => data.outcome !== 'refused' || data.reason !== null, {
    message: 'A refused message names its reason',
    path: ['reason']
  })

export const DotRemoteValidationResultDataSchema = z
  .object({
    verdict: z.enum(['pass', 'fail', 'inconclusive']),
    line: dotRemoteEnglishLine(
      DOT_REMOTE_VALIDATION_LINE_MAX_CHARS,
      'One English validation record line, secrets masked'
    )
  })
  .strict()

/** An artifact is named by an opaque id; its path and contents never leave the PC. */
export const DotRemoteArtifactRefSchema = z
  .object({
    artifactId: DotRemoteArtifactIdSchema,
    sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    sha256: DotRemoteSha256Schema
  })
  .strict()

export const DotRemoteDeliverableSummaryDataSchema = z
  .object({
    summary: dotRemoteEnglishLine(
      DOT_REMOTE_DELIVERABLE_SUMMARY_MAX_CHARS,
      'The English run summary, secrets masked; never file contents'
    ),
    artifacts: z.array(DotRemoteArtifactRefSchema).max(DOT_REMOTE_ARTIFACT_MAX)
  })
  .strict()

/** The narrow U32 exception (G7): exactly the v3 view, masked on the desktop; the Site adds nothing. */
export const DotRemoteValidationPendingDataSchema = DotValidationViewSchema
/** How a waiting decision ended: waived or rejected by whichever decision won, or closed without one. */
export const DotRemoteValidationSettledDataSchema = DotValidationSettledSchema

const eventFields = {
  eventId: DotRemoteEventIdSchema,
  dotRequestId: DotRequestIdSchema,
  sourceRevision: DotRemoteSourceRevisionSchema,
  at: DotRemoteTimestampSchema
}

function eventVariant<Kind extends DotRemoteEventKind, Data extends z.ZodType>(
  kind: Kind,
  data: Data
) {
  return z.object({ ...eventFields, kind: z.literal(kind), data }).strict()
}

/** A prompt or pending validation event belongs to the request named on its envelope. */
function promptOfItsRequest(event: {
  dotRequestId: string
  data: { dotRequestId: string }
}): boolean {
  return event.data.dotRequestId === event.dotRequestId
}
const PROMPT_REQUEST_MISMATCH = {
  message: 'The prompt belongs to another request',
  path: ['data', 'dotRequestId']
}
const VALIDATION_REQUEST_MISMATCH = {
  message: 'The validation decision belongs to another request',
  path: ['data', 'dotRequestId']
}

export const DOT_REMOTE_EVENT_VARIANTS = {
  request_status: eventVariant('request_status', DotRemoteRequestStatusDataSchema),
  permission_prompt_opened: eventVariant(
    'permission_prompt_opened',
    DotRemotePromptOpenedDataSchema
  ).refine(promptOfItsRequest, PROMPT_REQUEST_MISMATCH),
  permission_prompt_closed: eventVariant(
    'permission_prompt_closed',
    DotRemotePromptClosedDataSchema
  ).refine(promptOfItsRequest, PROMPT_REQUEST_MISMATCH),
  message_outcome: eventVariant('message_outcome', DotRemoteMessageOutcomeDataSchema),
  validation_result: eventVariant('validation_result', DotRemoteValidationResultDataSchema),
  deliverable_summary: eventVariant('deliverable_summary', DotRemoteDeliverableSummaryDataSchema),
  validation_decision_pending: eventVariant(
    'validation_decision_pending',
    DotRemoteValidationPendingDataSchema
  ).refine(promptOfItsRequest, VALIDATION_REQUEST_MISMATCH),
  validation_decision_settled: eventVariant(
    'validation_decision_settled',
    DotRemoteValidationSettledDataSchema
  )
} as const satisfies Record<DotRemoteEventKind, z.ZodType>

export const DotRemoteEventSchema = z.discriminatedUnion('kind', [
  DOT_REMOTE_EVENT_VARIANTS.request_status,
  DOT_REMOTE_EVENT_VARIANTS.permission_prompt_opened,
  DOT_REMOTE_EVENT_VARIANTS.permission_prompt_closed,
  DOT_REMOTE_EVENT_VARIANTS.message_outcome,
  DOT_REMOTE_EVENT_VARIANTS.validation_result,
  DOT_REMOTE_EVENT_VARIANTS.deliverable_summary,
  DOT_REMOTE_EVENT_VARIANTS.validation_decision_pending,
  DOT_REMOTE_EVENT_VARIANTS.validation_decision_settled
])

/** Events of one request must appear in increasing sourceRevision; the Site applies them in order. */
export const DotRemoteEventBatchSchema = z
  .object({
    generation: DotRemoteGenerationSchema,
    events: z.array(DotRemoteEventSchema).min(1).max(DOT_REMOTE_EVENT_BATCH_MAX)
  })
  .strict()

export const DOT_REMOTE_EVENT_RESULT_STATUSES = [
  'applied',
  'duplicate',
  'stale',
  'conflict',
  'unknown_request'
] as const

export const DotRemoteEventBatchResultSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            eventId: DotRemoteEventIdSchema,
            status: z.enum(DOT_REMOTE_EVENT_RESULT_STATUSES)
          })
          .strict()
      )
      .max(DOT_REMOTE_EVENT_BATCH_MAX),
    /** Per request, the highest sourceRevision the Site has applied: NASH resends from here. */
    cursors: z
      .array(
        z
          .object({
            dotRequestId: DotRequestIdSchema,
            appliedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
          })
          .strict()
      )
      .max(DOT_REMOTE_EVENT_BATCH_MAX)
  })
  .strict()

export type DotRemoteEvent = z.infer<typeof DotRemoteEventSchema>

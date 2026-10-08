import { z } from 'zod'
import { DeliverableLanguageSchema } from '../deliverable-language'
import { WORKBENCH_LIST_MAX_LIMIT, WorkbenchPositiveIntegerSchema } from '../workbench-request'
import {
  DOT_INGRESS_ARTIFACT_MAX,
  DOT_INGRESS_CONTRACT_VERSION,
  DOT_WORKSPACE_LABEL_MAX_CHARS
} from './dot-ingress-limits'
import {
  DotReplyMetadataSchema,
  DotRequestAccessSchema,
  DotRequestIdSchema,
  DotWorkspaceRefSchema
} from './dot-ingress-params'
import { DOT_MESSAGE_TEXT_MAX_CHARS } from './dot-ingress-message'
import {
  DOT_VALIDATION_SUMMARY_MAX_CHARS,
  DOT_VALIDATION_TITLE_MAX_CHARS
} from './dot-ingress-validation'
import { DOT_INGRESS_METHOD_NAMES } from './dot-ingress-versions'
import { DOT_REQUEST_STATUS_TEXT } from './dot-ingress-status-text'

// No dot-facing view has an objective: results become cloud context and the dot already holds its own text.

const ContractVersionSchema = z.literal(DOT_INGRESS_CONTRACT_VERSION)
const TimestampSchema = z.iso.datetime({ offset: true })

/** Coarse run state only: no task, model, effort, route or terminal detail ever reaches the dot (U32). */
export const DOT_RUN_STATES = [
  'not_started',
  'launching',
  'active',
  'completing',
  'completed',
  'failed',
  'canceled',
  'blocked',
  'unverifiable'
] as const
export const DOT_RUN_BLOCKERS = [
  'coordinator_route_unavailable',
  'workspace_unavailable',
  'launch_failed',
  'other'
] as const

export const DotRunViewSchema = z
  .object({ state: z.enum(DOT_RUN_STATES), blocker: z.enum(DOT_RUN_BLOCKERS).nullable() })
  .strict()
  .refine((run) => (run.state === 'blocked') === (run.blocker !== null), {
    message: 'A blocker code belongs to a blocked run only',
    path: ['blocker']
  })

/** References only, never a path or content; releasing content to the cloud awaits decision N-10. */
export const DotArtifactRefSchema = z
  .object({
    artifactId: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    kind: z.enum(['file', 'summary', 'report']),
    label: z.string().min(1).max(120),
    mediaType: z
      .string()
      .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i),
    sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    language: DeliverableLanguageSchema.nullable()
  })
  .strict()

/** Reserved for an English run summary; null until content release is enabled. */
export const DotResultSchema = z.null()

const requestFields = {
  contractVersion: ContractVersionSchema,
  dotRequestId: DotRequestIdSchema,
  sequence: WorkbenchPositiveIntegerSchema,
  revision: WorkbenchPositiveIntegerSchema,
  workspaceRef: DotWorkspaceRefSchema,
  requestedAccess: DotRequestAccessSchema,
  reply: DotReplyMetadataSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  result: DotResultSchema,
  artifacts: z.array(DotArtifactRefSchema).max(DOT_INGRESS_ARTIFACT_MAX)
}

// Generic so each variant keeps its own literal state and text for the discriminated union.
function requestVariant<State extends string, Text extends string, Run extends z.ZodType>(
  state: State,
  text: Text,
  run: Run
) {
  return z
    .object({
      ...requestFields,
      state: z.literal(state),
      statusText: z.literal(text),
      run
    })
    .strict()
}

/** The run view exists while the request is received or submitted; a canceled or failed one has none. */
export const DotRequestViewSchema = z.discriminatedUnion('state', [
  requestVariant('received', DOT_REQUEST_STATUS_TEXT.received, DotRunViewSchema),
  requestVariant('submitted', DOT_REQUEST_STATUS_TEXT.submitted, DotRunViewSchema),
  requestVariant('canceled', DOT_REQUEST_STATUS_TEXT.canceled, z.null()),
  requestVariant('failed', DOT_REQUEST_STATUS_TEXT.failed, z.null())
])

// Format (bidi, zero-width, tag), private-use, unassigned and lone surrogate code points.
const INVISIBLE_CHARACTER = /[\p{Cf}\p{Co}\p{Cn}\p{Cs}]/u

export const DOT_WORKSPACE_LABEL_INVISIBLE_MESSAGE =
  'The workspace label contains invisible characters, such as bidi controls, zero-width or tag characters. Use a label without them.'

/** True when a label holds a character dot reads but the user cannot see. */
export function hasInvisibleLabelCharacter(label: string): boolean {
  return INVISIBLE_CHARACTER.test(label)
}

/**
 * Label is user-chosen display text: capped, single-line, free of path separators and of
 * invisible characters. The last check is a refinement, so invisible text is rejected before publication.
 */
export const DotWorkspaceLabelSchema = z
  .string()
  .min(1)
  .max(DOT_WORKSPACE_LABEL_MAX_CHARS)
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}\\/]+$/u)
  .refine((label) => !hasInvisibleLabelCharacter(label), {
    message: DOT_WORKSPACE_LABEL_INVISIBLE_MESSAGE
  })
export const DotWorkspaceViewSchema = z
  .object({
    workspaceRef: DotWorkspaceRefSchema,
    label: DotWorkspaceLabelSchema,
    maxAccess: DotRequestAccessSchema
  })
  .strict()

export const DotSubmitResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    request: DotRequestViewSchema,
    duplicate: z.boolean()
  })
  .strict()

export const DotStatusResultSchema = z
  .object({ contractVersion: ContractVersionSchema, request: DotRequestViewSchema })
  .strict()

export const DotListResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    requests: z.array(DotRequestViewSchema).max(WORKBENCH_LIST_MAX_LIMIT),
    nextBeforeSequence: WorkbenchPositiveIntegerSchema.nullable()
  })
  .strict()

export const DotCancelResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    request: DotRequestViewSchema,
    changed: z.boolean()
  })
  .strict()

export const DotWorkspacesResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    workspaces: z.array(DotWorkspaceViewSchema).max(WORKBENCH_LIST_MAX_LIMIT)
  })
  .strict()

/** The interface cannot know whether a dot is linked, so no field here can claim a connection. */
export const DotHelloResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    supportedContractVersions: z.tuple([z.literal(DOT_INGRESS_CONTRACT_VERSION)]),
    methods: z
      .array(z.enum(DOT_INGRESS_METHOD_NAMES))
      .min(1)
      .max(DOT_INGRESS_METHOD_NAMES.length)
      .refine((names) => new Set(names).size === names.length, 'Method names must be unique'),
    limits: z
      .object({
        maxObjectiveChars: z.number().int().positive(),
        maxProseChars: z.number().int().positive(),
        listMaxLimit: z.number().int().positive(),
        /** The user's current caps, which the user can change. */
        maxSubmissionsPerMinute: z.number().int().positive(),
        maxSubmissionsPerUtcDay: z.number().int().positive(),
        maxDecisionSummaryChars: z.number().int().positive(),
        maxMessageChars: z.literal(DOT_MESSAGE_TEXT_MAX_CHARS),
        maxValidationTitleChars: z.literal(DOT_VALIDATION_TITLE_MAX_CHARS),
        maxValidationSummaryChars: z.literal(DOT_VALIDATION_SUMMARY_MAX_CHARS)
      })
      .strict(),
    capabilities: z
      .object({
        /** A valid request starts without any confirmation step in the app. */
        startsWithoutConfirmation: z.literal(true),
        results: z.literal(false),
        artifacts: z.literal(false),
        validationDecisions: z.literal(true)
      })
      .strict()
  })
  .strict()

export type DotRunView = z.infer<typeof DotRunViewSchema>
export type DotRequestView = z.infer<typeof DotRequestViewSchema>
export type DotWorkspaceView = z.infer<typeof DotWorkspaceViewSchema>
export type DotSubmitResult = z.infer<typeof DotSubmitResultSchema>
export type DotStatusResult = z.infer<typeof DotStatusResultSchema>
export type DotListResult = z.infer<typeof DotListResultSchema>
export type DotCancelResult = z.infer<typeof DotCancelResultSchema>
export type DotWorkspacesResult = z.infer<typeof DotWorkspacesResultSchema>
export type DotHelloResult = z.infer<typeof DotHelloResultSchema>

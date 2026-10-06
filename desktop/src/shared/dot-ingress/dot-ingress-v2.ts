import { z } from 'zod'
import { WORKBENCH_LIST_MAX_LIMIT } from '../workbench-request'
import {
  DotDecisionAnswerResultSchema,
  DotDecisionsListResultSchema,
  DotDecisionViewSchema
} from './dot-ingress-decision'
import { DOT_MESSAGE_TEXT_MAX_CHARS } from './dot-ingress-message'
import {
  DotCancelParams,
  DotDecisionAnswerParams,
  DotDecisionsListParams,
  DotHelloParams,
  DotListParams,
  DotRequestAccessSchema,
  DotStatusParams,
  DotSubmitParams,
  DotWorkspacesParams
} from './dot-ingress-params'
import {
  DotCancelResultSchema,
  DotHelloResultSchema,
  DotListResultSchema,
  DotRequestViewSchema,
  DotStatusResultSchema,
  DotSubmitResultSchema,
  DotWorkspaceViewSchema
} from './dot-ingress-request'
import {
  DOT_INGRESS_CONTRACT_VERSION_TWO,
  DOT_INGRESS_V2_METHOD_NAMES
} from './dot-ingress-versions'

// Contract version 2 (RG2). Each schema is its version 1 counterpart with the version pinned to 2,
// plus the access ceiling fields and the `closed` decision outcome. It adds no progress, validation,
// deliverable or artifact-path field: disclosing those is a later user decision.

const Version = { contractVersion: z.literal(DOT_INGRESS_CONTRACT_VERSION_TWO) }

export const DotHelloParamsV2 = DotHelloParams.extend(Version)
export const DotWorkspacesParamsV2 = DotWorkspacesParams.extend(Version)
export const DotSubmitParamsV2 = DotSubmitParams.extend(Version)
export const DotStatusParamsV2 = DotStatusParams.extend(Version)
export const DotListParamsV2 = DotListParams.extend(Version)
export const DotCancelParamsV2 = DotCancelParams.extend(Version)
export const DotDecisionsListParamsV2 = DotDecisionsListParams.extend(Version)
export const DotDecisionAnswerParamsV2 = DotDecisionAnswerParams.extend(Version)

/** The recorded access of the request, which is the access ceiling of the run it starts. */
const RequestAccess = { requestedAccess: DotRequestAccessSchema }
const [ReceivedView, SubmittedView, CanceledView, FailedView] = DotRequestViewSchema.options
export const DotRequestViewV2Schema = z.discriminatedUnion('state', [
  ReceivedView.extend({ ...Version, ...RequestAccess }),
  SubmittedView.extend({ ...Version, ...RequestAccess }),
  CanceledView.extend({ ...Version, ...RequestAccess }),
  FailedView.extend({ ...Version, ...RequestAccess })
])

/** The most access a request to this workspace may state, set by the user when enabling it. */
export const DotWorkspaceViewV2Schema = DotWorkspaceViewSchema.extend({
  maxAccess: DotRequestAccessSchema
})

/** False when dot may only deny: a command or edit prompt on a run that is not allowed to write (RG7). */
export const DotDecisionViewV2Schema = DotDecisionViewSchema.extend({ dotMayAllow: z.boolean() })

export const DotHelloResultV2Schema = z
  .object({
    ...Version,
    supportedContractVersions: z.tuple([z.literal(1), z.literal(DOT_INGRESS_CONTRACT_VERSION_TWO)]),
    /** Exactly the methods registered on the endpoint answering this call. */
    methods: z
      .array(z.enum(DOT_INGRESS_V2_METHOD_NAMES))
      .min(1)
      .max(DOT_INGRESS_V2_METHOD_NAMES.length)
      .refine((names) => new Set(names).size === names.length, 'Method names must be unique'),
    limits: DotHelloResultSchema.shape.limits.extend({
      maxMessageChars: z.literal(DOT_MESSAGE_TEXT_MAX_CHARS)
    }),
    capabilities: z
      .object({
        startsWithoutConfirmation: z.literal(true),
        results: z.literal(false),
        artifacts: z.literal(false)
      })
      .strict()
  })
  .strict()

export const DotWorkspacesResultV2Schema = z
  .object({
    ...Version,
    workspaces: z.array(DotWorkspaceViewV2Schema).max(WORKBENCH_LIST_MAX_LIMIT)
  })
  .strict()

const RequestV2 = { ...Version, request: DotRequestViewV2Schema }
export const DotSubmitResultV2Schema = DotSubmitResultSchema.extend(RequestV2)
export const DotStatusResultV2Schema = DotStatusResultSchema.extend(RequestV2)
export const DotCancelResultV2Schema = DotCancelResultSchema.extend(RequestV2)
export const DotListResultV2Schema = DotListResultSchema.extend({
  ...Version,
  requests: z.array(DotRequestViewV2Schema).max(WORKBENCH_LIST_MAX_LIMIT)
})

export const DotDecisionsListResultV2Schema = DotDecisionsListResultSchema.extend({
  ...Version,
  decisions: z.array(DotDecisionViewV2Schema).max(WORKBENCH_LIST_MAX_LIMIT)
})

/** `closed`: the app no longer waits for an answer from outside; the prompt is answered in the app or terminal. */
export const DotDecisionAnswerResultV2Schema = DotDecisionAnswerResultSchema.extend({
  ...Version,
  outcome: z.enum(['decided', 'already_decided', 'closed']),
  decision: DotDecisionViewV2Schema
})

export type DotRequestViewV2 = z.infer<typeof DotRequestViewV2Schema>
export type DotWorkspaceViewV2 = z.infer<typeof DotWorkspaceViewV2Schema>
export type DotDecisionViewV2 = z.infer<typeof DotDecisionViewV2Schema>
export type DotHelloResultV2 = z.infer<typeof DotHelloResultV2Schema>
export type DotWorkspacesResultV2 = z.infer<typeof DotWorkspacesResultV2Schema>
export type DotSubmitResultV2 = z.infer<typeof DotSubmitResultV2Schema>
export type DotStatusResultV2 = z.infer<typeof DotStatusResultV2Schema>
export type DotCancelResultV2 = z.infer<typeof DotCancelResultV2Schema>
export type DotListResultV2 = z.infer<typeof DotListResultV2Schema>
export type DotDecisionsListResultV2 = z.infer<typeof DotDecisionsListResultV2Schema>
export type DotDecisionAnswerResultV2 = z.infer<typeof DotDecisionAnswerResultV2Schema>

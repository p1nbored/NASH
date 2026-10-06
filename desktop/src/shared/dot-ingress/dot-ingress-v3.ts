import { z } from 'zod'
import { WORKBENCH_LIST_MAX_LIMIT } from '../workbench-request'
import { DotMessageParams, DotMessageResultSchema } from './dot-ingress-message'
import {
  DotCancelParamsV2,
  DotCancelResultV2Schema,
  DotDecisionAnswerParamsV2,
  DotDecisionAnswerResultV2Schema,
  DotDecisionsListParamsV2,
  DotDecisionsListResultV2Schema,
  DotDecisionViewV2Schema,
  DotHelloParamsV2,
  DotHelloResultV2Schema,
  DotListParamsV2,
  DotListResultV2Schema,
  DotRequestViewV2Schema,
  DotStatusParamsV2,
  DotStatusResultV2Schema,
  DotSubmitParamsV2,
  DotSubmitResultV2Schema,
  DotWorkspacesParamsV2,
  DotWorkspacesResultV2Schema,
  DotWorkspaceViewV2Schema
} from './dot-ingress-v2'
import {
  DOT_VALIDATION_SUMMARY_MAX_CHARS,
  DOT_VALIDATION_TITLE_MAX_CHARS
} from './dot-ingress-validation'
import {
  DOT_INGRESS_CONTRACT_VERSION_THREE,
  DOT_INGRESS_METHOD_NAMES
} from './dot-ingress-versions'

// Contract version 3 (G7). Each version 2 schema with the version pinned to 3; the validation
// decision schemas live in dot-ingress-validation.ts. Nothing else about a run is disclosed.

const Version = { contractVersion: z.literal(DOT_INGRESS_CONTRACT_VERSION_THREE) }

export const DotHelloParamsV3 = DotHelloParamsV2.extend(Version)
export const DotWorkspacesParamsV3 = DotWorkspacesParamsV2.extend(Version)
export const DotSubmitParamsV3 = DotSubmitParamsV2.extend(Version)
export const DotStatusParamsV3 = DotStatusParamsV2.extend(Version)
export const DotListParamsV3 = DotListParamsV2.extend(Version)
export const DotCancelParamsV3 = DotCancelParamsV2.extend(Version)
export const DotMessageParamsV3 = DotMessageParams.extend(Version)
export const DotDecisionsListParamsV3 = DotDecisionsListParamsV2.extend(Version)
export const DotDecisionAnswerParamsV3 = DotDecisionAnswerParamsV2.extend(Version)

const [ReceivedView, SubmittedView, CanceledView, FailedView] = DotRequestViewV2Schema.options
export const DotRequestViewV3Schema = z.discriminatedUnion('state', [
  ReceivedView.extend(Version),
  SubmittedView.extend(Version),
  CanceledView.extend(Version),
  FailedView.extend(Version)
])

/** Unchanged from version 2: neither view carries a contract version. */
export const DotWorkspaceViewV3Schema = DotWorkspaceViewV2Schema
export const DotDecisionViewV3Schema = DotDecisionViewV2Schema

const RequestV3 = { ...Version, request: DotRequestViewV3Schema }
export const DotSubmitResultV3Schema = DotSubmitResultV2Schema.extend(RequestV3)
export const DotStatusResultV3Schema = DotStatusResultV2Schema.extend(RequestV3)
export const DotCancelResultV3Schema = DotCancelResultV2Schema.extend(RequestV3)
export const DotListResultV3Schema = DotListResultV2Schema.extend({
  ...Version,
  requests: z.array(DotRequestViewV3Schema).max(WORKBENCH_LIST_MAX_LIMIT)
})
export const DotWorkspacesResultV3Schema = DotWorkspacesResultV2Schema.extend(Version)
export const DotDecisionsListResultV3Schema = DotDecisionsListResultV2Schema.extend(Version)
export const DotDecisionAnswerResultV3Schema = DotDecisionAnswerResultV2Schema.extend(Version)
// Why rebuilt from the shape: a refined schema cannot retype a key; the refinement is the same.
export const DotMessageResultV3Schema = z
  .object({ ...DotMessageResultSchema.shape, ...Version })
  .strict()
  .refine((result) => result.outcome !== 'refused' || result.reason !== null, {
    message: 'A refused message names its reason',
    path: ['reason']
  })

export const DotHelloResultV3Schema = DotHelloResultV2Schema.extend({
  ...Version,
  supportedContractVersions: z.tuple([
    z.literal(1),
    z.literal(2),
    z.literal(DOT_INGRESS_CONTRACT_VERSION_THREE)
  ]),
  /** Exactly the methods registered on the endpoint answering this call. */
  methods: z
    .array(z.enum(DOT_INGRESS_METHOD_NAMES))
    .min(1)
    .max(DOT_INGRESS_METHOD_NAMES.length)
    .refine((names) => new Set(names).size === names.length, 'Method names must be unique'),
  limits: DotHelloResultV2Schema.shape.limits.extend({
    maxValidationTitleChars: z.literal(DOT_VALIDATION_TITLE_MAX_CHARS),
    maxValidationSummaryChars: z.literal(DOT_VALIDATION_SUMMARY_MAX_CHARS)
  }),
  capabilities: z
    .object({
      startsWithoutConfirmation: z.literal(true),
      results: z.literal(false),
      artifacts: z.literal(false),
      /** dot may list and decide the inconclusive validations of the runs it started. */
      validationDecisions: z.literal(true)
    })
    .strict()
})

export type DotRequestViewV3 = z.infer<typeof DotRequestViewV3Schema>
export type DotHelloResultV3 = z.infer<typeof DotHelloResultV3Schema>
export type DotWorkspacesResultV3 = z.infer<typeof DotWorkspacesResultV3Schema>
export type DotSubmitResultV3 = z.infer<typeof DotSubmitResultV3Schema>
export type DotStatusResultV3 = z.infer<typeof DotStatusResultV3Schema>
export type DotCancelResultV3 = z.infer<typeof DotCancelResultV3Schema>
export type DotListResultV3 = z.infer<typeof DotListResultV3Schema>
export type DotDecisionsListResultV3 = z.infer<typeof DotDecisionsListResultV3Schema>
export type DotDecisionAnswerResultV3 = z.infer<typeof DotDecisionAnswerResultV3Schema>
export type DotMessageResultV3 = z.infer<typeof DotMessageResultV3Schema>

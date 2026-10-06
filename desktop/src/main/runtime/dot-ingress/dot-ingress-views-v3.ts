import type {
  DotCancelResultV2,
  DotDecisionAnswerResultV2,
  DotDecisionsListResultV2,
  DotListResultV2,
  DotRequestViewV2,
  DotStatusResultV2,
  DotSubmitResultV2,
  DotWorkspacesResultV2
} from '../../../shared/dot-ingress/dot-ingress-v2'
import {
  DotCancelResultV3Schema,
  DotDecisionAnswerResultV3Schema,
  DotDecisionsListResultV3Schema,
  DotListResultV3Schema,
  DotRequestViewV3Schema,
  DotStatusResultV3Schema,
  DotSubmitResultV3Schema,
  DotWorkspacesResultV3Schema,
  type DotRequestViewV3
} from '../../../shared/dot-ingress/dot-ingress-v3'
import {
  DotValidationDecideResultV3Schema,
  DotValidationsListResultV3Schema,
  type DotValidationDecideResultV3,
  type DotValidationsListResultV3
} from '../../../shared/dot-ingress/dot-ingress-validation'
import type { DotValidationPage } from './dot-ingress-validation-reads'
import type { DotValidationDecided } from './dot-ingress-validations-service'

// Version 3 results: the version 2 result with the version pinned to 3, inside every request view
// too. Each is parsed against its version 3 schema before it leaves, like every other dot result.

const V3 = { contractVersion: 3 } as const

function requestViewV3(view: DotRequestViewV2): DotRequestViewV3 {
  return DotRequestViewV3Schema.parse({ ...view, ...V3 })
}

export const toV3 = {
  workspaces: (result: DotWorkspacesResultV2) =>
    DotWorkspacesResultV3Schema.parse({ ...result, ...V3 }),
  submit: (result: DotSubmitResultV2) =>
    DotSubmitResultV3Schema.parse({ ...result, ...V3, request: requestViewV3(result.request) }),
  status: (result: DotStatusResultV2) =>
    DotStatusResultV3Schema.parse({ ...result, ...V3, request: requestViewV3(result.request) }),
  cancel: (result: DotCancelResultV2) =>
    DotCancelResultV3Schema.parse({ ...result, ...V3, request: requestViewV3(result.request) }),
  list: (result: DotListResultV2) =>
    DotListResultV3Schema.parse({ ...result, ...V3, requests: result.requests.map(requestViewV3) }),
  decisionsList: (result: DotDecisionsListResultV2) =>
    DotDecisionsListResultV3Schema.parse({ ...result, ...V3 }),
  decisionAnswer: (result: DotDecisionAnswerResultV2) =>
    DotDecisionAnswerResultV3Schema.parse({ ...result, ...V3 })
} as const

export function validationsListResult(page: DotValidationPage): DotValidationsListResultV3 {
  return DotValidationsListResultV3Schema.parse({
    ...V3,
    validations: page.views,
    hasMore: page.hasMore
  })
}

export function validationDecideResult(decided: DotValidationDecided): DotValidationDecideResultV3 {
  return DotValidationDecideResultV3Schema.parse({ ...V3, ...decided })
}

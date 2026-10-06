import { describe, expect, it } from 'vitest'
import { DotMessageParams } from './dot-ingress-message'
import {
  DotCancelParamsV2,
  DotDecisionAnswerParamsV2,
  DotHelloParamsV2,
  DotRequestViewV2Schema
} from './dot-ingress-v2'
import {
  DotCancelParamsV3,
  DotCancelResultV3Schema,
  DotDecisionAnswerParamsV3,
  DotDecisionAnswerResultV3Schema,
  DotDecisionsListParamsV3,
  DotHelloParamsV3,
  DotHelloResultV3Schema,
  DotListParamsV3,
  DotMessageParamsV3,
  DotMessageResultV3Schema,
  DotRequestViewV3Schema,
  DotStatusParamsV3,
  DotSubmitParamsV3,
  DotWorkspacesParamsV3
} from './dot-ingress-v3'
import { DOT_INGRESS_METHOD_NAMES } from './dot-ingress-versions'

const REQUEST_ID = '00000000-0000-4000-8000-000000000001'
const DECISION_ID = '00000000-0000-4000-8000-000000000003'
const WORKSPACE_REF = `dws_${'a'.repeat(24)}`
const TIME = '2026-10-06T00:00:00.000Z'

function requestView(contractVersion: number): Record<string, unknown> {
  return {
    contractVersion,
    dotRequestId: REQUEST_ID,
    sequence: 1,
    revision: 2,
    workspaceRef: WORKSPACE_REF,
    deliverableLanguage: null,
    reply: null,
    createdAt: TIME,
    updatedAt: TIME,
    result: null,
    artifacts: [],
    state: 'submitted',
    statusText: 'The request was handed to the workbench and starts without further confirmation.',
    run: { state: 'active', blocker: null },
    requestedAccess: 'read_only'
  }
}

function hello(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 3,
    supportedContractVersions: [1, 2, 3],
    methods: [...DOT_INGRESS_METHOD_NAMES],
    limits: {
      maxObjectiveChars: 12000,
      maxProseChars: 2000,
      listMaxLimit: 100,
      maxSubmissionsPerMinute: 6,
      maxSubmissionsPerUtcDay: 100,
      maxDecisionSummaryChars: 500,
      maxMessageChars: 4000,
      maxValidationTitleChars: 200,
      maxValidationSummaryChars: 500
    },
    capabilities: {
      startsWithoutConfirmation: true,
      results: false,
      artifacts: false,
      validationDecisions: true
    },
    ...overrides
  }
}

describe('dot ingress contract version 3', () => {
  it('pins every version 2 request to version 3 and refuses the other version both ways', () => {
    const cases = [
      [DotHelloParamsV3, DotHelloParamsV2, {}],
      [DotCancelParamsV3, DotCancelParamsV2, { dotRequestId: REQUEST_ID }],
      [
        DotDecisionAnswerParamsV3,
        DotDecisionAnswerParamsV2,
        { decisionId: DECISION_ID, decision: 'deny' }
      ],
      [
        DotMessageParamsV3,
        DotMessageParams,
        { dotRequestId: REQUEST_ID, messageId: DECISION_ID, text: 'Also list the owners.' }
      ]
    ] as const
    for (const [v3, v2, rest] of cases) {
      expect(v3.safeParse({ contractVersion: 3, ...rest }).success).toBe(true)
      expect(v3.safeParse({ contractVersion: 2, ...rest }).success).toBe(false)
      expect(v2.safeParse({ contractVersion: 3, ...rest }).success).toBe(false)
    }
    for (const [schema, rest] of [
      [DotWorkspacesParamsV3, {}],
      [DotStatusParamsV3, { dotRequestId: REQUEST_ID }],
      [DotListParamsV3, {}],
      [DotDecisionsListParamsV3, {}]
    ] as const) {
      expect(schema.safeParse({ contractVersion: 3, ...rest }).success).toBe(true)
      expect(schema.safeParse({ contractVersion: 3, ...rest, extra: 1 }).success).toBe(false)
    }
    const submit = {
      contractVersion: 3,
      workspaceRef: WORKSPACE_REF,
      objective: 'Summarize the open issues.',
      idempotencyKey: REQUEST_ID
    }
    expect(DotSubmitParamsV3.parse(submit).requestedAccess).toBe('read_only')
    expect(DotSubmitParamsV3.safeParse({ ...submit, approved: true }).success).toBe(false)
  })

  it('carries version 3 inside the request view and every result', () => {
    expect(DotRequestViewV3Schema.parse(requestView(3))).toEqual(requestView(3))
    expect(DotRequestViewV3Schema.safeParse(requestView(2)).success).toBe(false)
    expect(DotRequestViewV2Schema.safeParse(requestView(3)).success).toBe(false)
    expect(
      DotCancelResultV3Schema.safeParse({
        contractVersion: 3,
        request: requestView(3),
        changed: true
      }).success
    ).toBe(true)
    expect(
      DotMessageResultV3Schema.safeParse({
        contractVersion: 3,
        dotRequestId: REQUEST_ID,
        messageId: DECISION_ID,
        outcome: 'refused',
        reason: null,
        duplicate: false
      }).success
    ).toBe(false)
    expect(
      DotDecisionAnswerResultV3Schema.safeParse({
        contractVersion: 3,
        outcome: 'closed',
        decision: {
          decisionId: DECISION_ID,
          dotRequestId: REQUEST_ID,
          toolName: 'Bash',
          agentId: null,
          summary: 'Bash: git status',
          status: 'expired',
          decidedBy: null,
          createdAt: TIME,
          deadlineAt: TIME,
          decidedAt: TIME,
          dotMayAllow: false
        }
      }).success
    ).toBe(true)
  })

  it('answers hello with all three versions, the validation capability and its bounds', () => {
    expect(DotHelloResultV3Schema.parse(hello())).toEqual(hello())
    expect(
      DotHelloResultV3Schema.safeParse(hello({ supportedContractVersions: [1, 2] })).success
    ).toBe(false)
    expect(
      DotHelloResultV3Schema.safeParse(hello({ methods: ['dotIngress.hello', 'dotIngress.hello'] }))
        .success
    ).toBe(false)
    expect(
      DotHelloResultV3Schema.safeParse(
        hello({ capabilities: { ...(hello().capabilities as object), results: true } })
      ).success
    ).toBe(false)
  })
})

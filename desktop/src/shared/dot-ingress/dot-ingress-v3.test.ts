import { describe, expect, it } from 'vitest'
import {
  DotCancelParams,
  DotDecisionAnswerParams,
  DotDecisionsListParams,
  DotHelloParams,
  DotListParams,
  DotStatusParams,
  DotSubmitParams,
  DotWorkspacesParams
} from './dot-ingress-params'
import {
  DotCancelResultSchema,
  DotHelloResultSchema,
  DotRequestViewSchema
} from './dot-ingress-request'
import { DotDecisionAnswerResultSchema } from './dot-ingress-decision'
import { DotMessageParams, DotMessageResultSchema } from './dot-ingress-message'
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
    supportedContractVersions: [3],
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
  it('accepts only current request schemas', () => {
    for (const [schema, rest] of [
      [DotHelloParams, {}],
      [DotCancelParams, { dotRequestId: REQUEST_ID }],
      [DotDecisionAnswerParams, { decisionId: DECISION_ID, decision: 'deny' }],
      [
        DotMessageParams,
        { dotRequestId: REQUEST_ID, messageId: DECISION_ID, text: 'Also list the owners.' }
      ]
    ] as const) {
      expect(schema.safeParse({ contractVersion: 3, ...rest }).success).toBe(true)
      for (const contractVersion of [1, 2]) {
        expect(schema.safeParse({ contractVersion, ...rest }).success).toBe(false)
      }
    }
    for (const [schema, rest] of [
      [DotWorkspacesParams, {}],
      [DotStatusParams, { dotRequestId: REQUEST_ID }],
      [DotListParams, {}],
      [DotDecisionsListParams, {}]
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
    expect(DotSubmitParams.parse(submit).requestedAccess).toBe('read_only')
    expect(DotSubmitParams.safeParse({ ...submit, approved: true }).success).toBe(false)
  })

  it('carries version 3 inside the request view and every result', () => {
    expect(DotRequestViewSchema.parse(requestView(3))).toEqual(requestView(3))
    expect(DotRequestViewSchema.safeParse(requestView(2)).success).toBe(false)
    expect(
      DotCancelResultSchema.safeParse({
        contractVersion: 3,
        request: requestView(3),
        changed: true
      }).success
    ).toBe(true)
    expect(
      DotMessageResultSchema.safeParse({
        contractVersion: 3,
        dotRequestId: REQUEST_ID,
        messageId: DECISION_ID,
        outcome: 'refused',
        reason: null,
        duplicate: false
      }).success
    ).toBe(false)
    expect(
      DotDecisionAnswerResultSchema.safeParse({
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

  it('answers hello with the current version, the validation capability and its bounds', () => {
    expect(DotHelloResultSchema.parse(hello())).toEqual(hello())
    expect(
      DotHelloResultSchema.safeParse(hello({ supportedContractVersions: [1, 2] })).success
    ).toBe(false)
    expect(
      DotHelloResultSchema.safeParse(hello({ methods: ['dotIngress.hello', 'dotIngress.hello'] }))
        .success
    ).toBe(false)
    expect(
      DotHelloResultSchema.safeParse(
        hello({ capabilities: { ...(hello().capabilities as object), results: true } })
      ).success
    ).toBe(false)
  })
})

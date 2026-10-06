import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DotCancelParamsV2,
  DotDecisionAnswerParamsV2,
  DotDecisionAnswerResultV2Schema,
  DotDecisionViewV2Schema,
  DotHelloParamsV2,
  DotHelloResultV2Schema,
  DotListParamsV2,
  DotRequestViewV2Schema,
  DotStatusParamsV2,
  DotSubmitParamsV2,
  DotWorkspacesParamsV2,
  DotWorkspacesResultV2Schema
} from './dot-ingress-v2'
import { DotSubmitParams } from './dot-ingress-params'
import { DotRequestViewSchema } from './dot-ingress-request'

const REQUEST_ID = '00000000-0000-4000-8000-000000000001'
const DECISION_ID = '00000000-0000-4000-8000-000000000003'
const WORKSPACE_REF = `dws_${'a'.repeat(24)}`
const TIME = '2026-10-05T00:00:00.000Z'

function requestView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 2,
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
    requestedAccess: 'read_only',
    ...overrides
  }
}

function decisionView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decisionId: DECISION_ID,
    dotRequestId: REQUEST_ID,
    toolName: 'Bash',
    agentId: null,
    summary: 'Bash: git status',
    status: 'pending',
    decidedBy: null,
    createdAt: TIME,
    deadlineAt: TIME,
    decidedAt: null,
    dotMayAllow: false,
    ...overrides
  }
}

describe('dot ingress contract version 2', () => {
  it('versions every request: params of version 2 refuse version 1 and the reverse', () => {
    const cases = [
      [DotHelloParamsV2, {}],
      [DotWorkspacesParamsV2, {}],
      [DotStatusParamsV2, { dotRequestId: REQUEST_ID }],
      [DotListParamsV2, {}],
      [DotCancelParamsV2, { dotRequestId: REQUEST_ID }],
      [DotDecisionAnswerParamsV2, { decisionId: DECISION_ID, decision: 'deny' }]
    ] as const
    for (const [schema, rest] of cases) {
      expect(schema.safeParse({ contractVersion: 2, ...rest }).success).toBe(true)
      expect(schema.safeParse({ contractVersion: 1, ...rest }).success).toBe(false)
    }
    const submit = {
      workspaceRef: WORKSPACE_REF,
      objective: 'Summarize the open issues.',
      idempotencyKey: REQUEST_ID
    }
    expect(DotSubmitParamsV2.safeParse({ contractVersion: 2, ...submit }).success).toBe(true)
    expect(DotSubmitParams.safeParse({ contractVersion: 2, ...submit }).success).toBe(false)
  })

  it('keeps the submit params strict and defaults access to read_only', () => {
    const parsed = DotSubmitParamsV2.parse({
      contractVersion: 2,
      workspaceRef: WORKSPACE_REF,
      objective: 'Summarize the open issues.',
      idempotencyKey: REQUEST_ID
    })
    expect(parsed.requestedAccess).toBe('read_only')
    expect(
      DotSubmitParamsV2.safeParse({ ...parsed, approved: true, maxAccess: 'workspace_write' })
        .success
    ).toBe(false)
  })

  it('shows the recorded access of a request, the access ceiling of a run', () => {
    expect(DotRequestViewV2Schema.parse(requestView())).toEqual(requestView())
    expect(
      DotRequestViewV2Schema.safeParse(requestView({ requestedAccess: 'admin' })).success
    ).toBe(false)
    const withoutAccess = requestView()
    delete withoutAccess.requestedAccess
    expect(DotRequestViewV2Schema.safeParse(withoutAccess).success).toBe(false)
    // The version 1 view is unchanged: it neither needs nor accepts the access field.
    expect(DotRequestViewSchema.safeParse({ ...requestView(), contractVersion: 1 }).success).toBe(
      false
    )
    expect(DotRequestViewSchema.safeParse({ ...withoutAccess, contractVersion: 1 }).success).toBe(
      true
    )
  })

  it('keeps the version 1 request rules: no run view on a canceled request, no objective', () => {
    expect(
      DotRequestViewV2Schema.safeParse(
        requestView({ state: 'canceled', statusText: 'This request was canceled.' })
      ).success
    ).toBe(false)
    expect(
      DotRequestViewV2Schema.safeParse(
        requestView({ state: 'canceled', statusText: 'This request was canceled.', run: null })
      ).success
    ).toBe(true)
    expect(DotRequestViewV2Schema.safeParse(requestView({ objective: 'x' })).success).toBe(false)
  })

  it('lists each workspace with the access ceiling the user set when enabling it', () => {
    const view = {
      contractVersion: 2,
      workspaces: [{ workspaceRef: WORKSPACE_REF, label: 'fixture-repo', maxAccess: 'read_only' }]
    }
    expect(DotWorkspacesResultV2Schema.parse(view)).toEqual(view)
    expect(
      DotWorkspacesResultV2Schema.safeParse({
        ...view,
        workspaces: [{ workspaceRef: WORKSPACE_REF, label: 'fixture-repo' }]
      }).success
    ).toBe(false)
  })

  it('tells dot whether it may allow a prompt, and keeps the decision consistency rules', () => {
    expect(DotDecisionViewV2Schema.parse(decisionView())).toEqual(decisionView())
    expect(
      DotDecisionViewV2Schema.safeParse(decisionView({ status: 'allowed', decidedBy: null }))
        .success
    ).toBe(false)
    expect(DotDecisionViewV2Schema.safeParse(decisionView({ dotMayAllow: 'yes' })).success).toBe(
      false
    )
  })

  it('adds the dot-side closed outcome to a decision answer', () => {
    for (const outcome of ['decided', 'already_decided', 'closed']) {
      expect(
        DotDecisionAnswerResultV2Schema.safeParse({
          contractVersion: 2,
          outcome,
          decision: decisionView()
        }).success,
        outcome
      ).toBe(true)
    }
    expect(
      DotDecisionAnswerResultV2Schema.safeParse({
        contractVersion: 2,
        outcome: 'expired',
        decision: decisionView()
      }).success
    ).toBe(false)
  })

  it('reports both served versions and the registered method names in hello', () => {
    const hello = {
      contractVersion: 2,
      supportedContractVersions: [1, 2],
      methods: ['dotIngress.hello', 'dotIngress.requests.message'],
      limits: {
        maxObjectiveChars: 12_000,
        maxProseChars: 2_000,
        listMaxLimit: 100,
        maxSubmissionsPerMinute: 6,
        maxSubmissionsPerUtcDay: 100,
        maxDecisionSummaryChars: 500,
        maxMessageChars: 4_000
      },
      capabilities: { startsWithoutConfirmation: true, results: false, artifacts: false }
    }
    expect(DotHelloResultV2Schema.parse(hello)).toEqual(hello)
    expect(
      DotHelloResultV2Schema.safeParse({ ...hello, methods: ['dotIngress.unknown'] }).success
    ).toBe(false)
    expect(
      DotHelloResultV2Schema.safeParse({
        ...hello,
        methods: ['dotIngress.hello', 'dotIngress.hello']
      }).success
    ).toBe(false)
    expect(
      DotHelloResultV2Schema.safeParse({
        ...hello,
        capabilities: { ...hello.capabilities, results: true }
      }).success
    ).toBe(false)
    expect(DotHelloResultV2Schema.safeParse({ ...hello, connected: true }).success).toBe(false)
  })

  it('has no progress, validation, deliverable or artifact-path field anywhere in version 2', () => {
    const schemas = [
      DotRequestViewV2Schema,
      DotDecisionViewV2Schema,
      DotHelloResultV2Schema,
      DotWorkspacesResultV2Schema
    ]
    for (const schema of schemas) {
      const text = JSON.stringify(z.toJSONSchema(schema))
      for (const word of ['progress', 'validation', 'deliverableSummary', 'path"', 'reviewer']) {
        expect(text.includes(word), word).toBe(false)
      }
    }
  })
})

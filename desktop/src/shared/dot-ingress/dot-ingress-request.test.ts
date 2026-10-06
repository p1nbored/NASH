import { describe, expect, it } from 'vitest'
import {
  DotArtifactRefSchema,
  DotCancelResultSchema,
  DotHelloResultSchema,
  DotListResultSchema,
  DotRequestViewSchema,
  DotResultSchema,
  DotRunViewSchema,
  DotStatusResultSchema,
  DotSubmitResultSchema,
  DotWorkspaceLabelSchema,
  DotWorkspacesResultSchema,
  DOT_WORKSPACE_LABEL_INVISIBLE_MESSAGE,
  type DotRequestView
} from './dot-ingress-request'
import { DOT_REQUEST_STATUS_TEXT } from './dot-ingress-status-text'

// FIXTURE_ONLY: synthetic ids and a made-up objective that must never appear in a dot view.
const SECRET_OBJECTIVE = 'Rewrite the billing module for ACME and list the findings.'

const noArtifacts: DotRequestView['artifacts'] = []

const common = {
  contractVersion: 1 as const,
  dotRequestId: 'd059ca24-0f93-4c06-b317-dc2a95d6920b',
  sequence: 4,
  revision: 1,
  workspaceRef: 'dws_0123456789abcdef01234567',
  deliverableLanguage: 'zh-Hans',
  reply: { correlationId: 'conv-1' },
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  result: null,
  artifacts: noArtifacts
}

const received = {
  ...common,
  state: 'received',
  statusText: DOT_REQUEST_STATUS_TEXT.received,
  run: { state: 'not_started', blocker: null }
} satisfies DotRequestView

const submitted = {
  ...common,
  state: 'submitted',
  revision: 2,
  statusText: DOT_REQUEST_STATUS_TEXT.submitted,
  run: { state: 'active', blocker: null }
} satisfies DotRequestView

const canceled = {
  ...common,
  state: 'canceled',
  statusText: DOT_REQUEST_STATUS_TEXT.canceled,
  run: null
} satisfies DotRequestView

const failed = {
  ...common,
  state: 'failed',
  statusText: DOT_REQUEST_STATUS_TEXT.failed,
  run: null
} satisfies DotRequestView

describe('DotRequestViewSchema', () => {
  it.each([received, submitted, canceled, failed])('accepts a consistent $state view', (view) => {
    expect(DotRequestViewSchema.parse(view)).toEqual(view)
  })

  it('has no confirmation state: nothing waits for the user before the request starts', () => {
    for (const state of [
      'awaiting_confirmation',
      'confirming',
      'confirmed',
      'rejected',
      'expired'
    ]) {
      expect(DotRequestViewSchema.safeParse({ ...received, state }).success).toBe(false)
    }
    expect(JSON.stringify(DOT_REQUEST_STATUS_TEXT)).not.toMatch(/awaiting|waiting for the user/i)
  })

  it('keeps a run view while received or submitted, and none once canceled or failed', () => {
    for (const state of ['canceled', 'failed'] as const) {
      const bad = {
        ...common,
        state,
        statusText: DOT_REQUEST_STATUS_TEXT[state],
        run: { state: 'active', blocker: null }
      }
      expect(DotRequestViewSchema.safeParse(bad).success).toBe(false)
    }
    expect(DotRequestViewSchema.safeParse({ ...submitted, run: null }).success).toBe(false)
    expect(DotRequestViewSchema.safeParse({ ...received, run: null }).success).toBe(false)
  })

  it('refuses a status text that does not belong to the state', () => {
    expect(
      DotRequestViewSchema.safeParse({ ...received, statusText: DOT_REQUEST_STATUS_TEXT.submitted })
        .success
    ).toBe(false)
    expect(DotRequestViewSchema.safeParse({ ...received, statusText: 'Waiting.' }).success).toBe(
      false
    )
  })

  it('has no objective, workspace id, path, access or identifier of Workbench, decisions or routing', () => {
    for (const field of [
      'objective',
      'workspaceId',
      'workspacePath',
      'requestId',
      'workbenchRequestId',
      'workflowRunId',
      'runId',
      'taskId',
      'decisionId',
      'modelProfileId',
      'executionSurface',
      'clefDecisionId',
      'principalId',
      'client',
      'senderAuth',
      'source',
      'requestedAccess',
      'expiresAt'
    ]) {
      expect(
        DotRequestViewSchema.safeParse({ ...submitted, [field]: SECRET_OBJECTIVE }).success
      ).toBe(false)
    }
  })

  it('never serializes the objective, even when a caller tries to attach it', () => {
    expect(
      DotRequestViewSchema.safeParse({ ...received, objective: SECRET_OBJECTIVE }).success
    ).toBe(false)
    expect(JSON.stringify(DotRequestViewSchema.parse(received))).not.toContain(SECRET_OBJECTIVE)
  })

  it('reserves the result as null and the artifact list as at most 50 references in v1', () => {
    expect(DotResultSchema.safeParse(null).success).toBe(true)
    expect(DotResultSchema.safeParse({ summary: 'done' }).success).toBe(false)
    expect(DotRequestViewSchema.safeParse({ ...received, result: { summary: 'x' } }).success).toBe(
      false
    )
    const artifact = {
      artifactId: 'art_1',
      kind: 'summary',
      label: 'Report',
      mediaType: 'text/markdown',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      language: null
    }
    expect(DotArtifactRefSchema.safeParse(artifact).success).toBe(true)
    expect(DotArtifactRefSchema.safeParse({ ...artifact, path: 'C:/x' }).success).toBe(false)
    expect(DotArtifactRefSchema.safeParse({ ...artifact, content: 'x' }).success).toBe(false)
    expect(
      DotRequestViewSchema.safeParse({
        ...received,
        artifacts: Array.from({ length: 51 }, () => artifact)
      }).success
    ).toBe(false)
  })

  it.each([
    ['deliverable language', { deliverableLanguage: 'en_US' }],
    ['revision', { revision: 0 }],
    ['sequence', { sequence: 0 }],
    ['request id', { dotRequestId: 'request-1' }],
    ['timestamp', { createdAt: 'yesterday' }],
    ['reply', { reply: { correlationId: 'a b' } }],
    ['contract version', { contractVersion: 2 }]
  ])('refuses an invalid %s', (_label, override) => {
    expect(DotRequestViewSchema.safeParse({ ...received, ...override }).success).toBe(false)
  })

  it('allows a null deliverable language and a null reply', () => {
    expect(
      DotRequestViewSchema.safeParse({ ...received, deliverableLanguage: null, reply: null })
        .success
    ).toBe(true)
  })
})

describe('DotRunViewSchema', () => {
  it('carries a blocker code only while the run is blocked', () => {
    expect(DotRunViewSchema.safeParse({ state: 'blocked', blocker: 'launch_failed' }).success).toBe(
      true
    )
    expect(DotRunViewSchema.safeParse({ state: 'blocked', blocker: null }).success).toBe(false)
    expect(DotRunViewSchema.safeParse({ state: 'active', blocker: 'launch_failed' }).success).toBe(
      false
    )
  })

  it.each([
    'not_started',
    'launching',
    'active',
    'completing',
    'completed',
    'failed',
    'canceled',
    'unverifiable'
  ])('accepts the coarse state %s', (state) => {
    expect(DotRunViewSchema.safeParse({ state, blocker: null }).success).toBe(true)
  })

  it('exposes nothing finer than a coarse state: no task, model, effort or route text', () => {
    for (const field of ['taskId', 'model', 'effort', 'route', 'target', 'tasks']) {
      expect(
        DotRunViewSchema.safeParse({ state: 'active', blocker: null, [field]: 'x' }).success
      ).toBe(false)
    }
    expect(DotRunViewSchema.safeParse({ state: 'running_task_3', blocker: null }).success).toBe(
      false
    )
    expect(
      DotRunViewSchema.safeParse({ state: 'blocked', blocker: 'budget exhausted' }).success
    ).toBe(false)
  })
})

describe('dot ingress result wrappers', () => {
  it('wraps one request for submit, status and cancel', () => {
    expect(
      DotSubmitResultSchema.parse({ contractVersion: 1, request: received, duplicate: false })
    ).toMatchObject({ duplicate: false })
    expect(DotStatusResultSchema.parse({ contractVersion: 1, request: submitted })).toBeTruthy()
    expect(
      DotCancelResultSchema.parse({
        contractVersion: 1,
        request: canceled,
        changed: true
      })
    ).toMatchObject({ changed: true })
    expect(DotSubmitResultSchema.safeParse({ contractVersion: 1, request: received }).success).toBe(
      false
    )
  })

  it('lists at most 100 requests with a nullable paging cursor', () => {
    expect(
      DotListResultSchema.safeParse({
        contractVersion: 1,
        requests: [received, submitted],
        nextBeforeSequence: null
      }).success
    ).toBe(true)
    expect(
      DotListResultSchema.safeParse({
        contractVersion: 1,
        requests: Array.from({ length: 101 }, () => received),
        nextBeforeSequence: null
      }).success
    ).toBe(false)
    expect(
      DotListResultSchema.safeParse({ contractVersion: 1, requests: [], nextBeforeSequence: 0 })
        .success
    ).toBe(false)
  })

  it('lists workspaces as an opaque ref and a path-free label only', () => {
    const ok = { workspaceRef: 'dws_0123456789abcdef01234567', label: 'billing-app' }
    expect(
      DotWorkspacesResultSchema.safeParse({ contractVersion: 1, workspaces: [ok] }).success
    ).toBe(true)
    for (const bad of [
      { ...ok, label: 'C:\\work\\billing' },
      { ...ok, label: 'work/billing' },
      { ...ok, label: '' },
      { ...ok, label: 'x'.repeat(121) },
      { ...ok, label: 'line\nbreak' },
      { ...ok, workspaceId: 'repo::/work/billing' },
      { ...ok, path: '/work/billing' }
    ]) {
      expect(
        DotWorkspacesResultSchema.safeParse({ contractVersion: 1, workspaces: [bad] }).success
      ).toBe(false)
    }
  })
})

describe('DotWorkspaceLabelSchema', () => {
  // Why: dot is a model that reads characters the user cannot see in the label.
  it.each([
    ['a bidi override', 'billing‮app'],
    ['a bidi isolate', 'billing⁦app'],
    ['a zero-width space', 'billing​app'],
    ['a zero-width joiner', 'billing‍app'],
    ['a tag character', 'billing\u{E0041}app'],
    ['a private-use character', 'billingapp'],
    ['an unassigned code point', 'billing͸app'],
    ['a lone surrogate', 'billing\uD800app']
  ])('refuses %s and says the label holds invisible characters', (_name, label) => {
    const parsed = DotWorkspaceLabelSchema.safeParse(label)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
      DOT_WORKSPACE_LABEL_INVISIBLE_MESSAGE
    ])
  })

  it('keeps visible non-ASCII text such as accents, CJK and emoji', () => {
    for (const label of ['Café billing', '請求アプリ', 'billing 🚀']) {
      expect(DotWorkspaceLabelSchema.safeParse(label).success, label).toBe(true)
    }
  })
})

describe('DotHelloResultSchema', () => {
  const hello = {
    contractVersion: 1,
    supportedContractVersions: [1],
    limits: {
      maxObjectiveChars: 12_000,
      maxProseChars: 2_000,
      listMaxLimit: 100,
      maxSubmissionsPerMinute: 6,
      maxSubmissionsPerUtcDay: 100,
      maxDecisionSummaryChars: 500
    },
    capabilities: {
      submit: true,
      status: true,
      list: true,
      cancel: true,
      decisions: true,
      startsWithoutConfirmation: true,
      results: false,
      artifacts: false
    }
  }

  it('tells the dot that requests start without confirmation and that results are not released', () => {
    expect(DotHelloResultSchema.parse(hello)).toEqual(hello)
    for (const field of ['startsWithoutConfirmation', 'cancel', 'decisions'] as const) {
      expect(
        DotHelloResultSchema.safeParse({
          ...hello,
          capabilities: { ...hello.capabilities, [field]: false }
        }).success
      ).toBe(false)
    }
    for (const field of ['results', 'artifacts'] as const) {
      expect(
        DotHelloResultSchema.safeParse({
          ...hello,
          capabilities: { ...hello.capabilities, [field]: true }
        }).success
      ).toBe(false)
    }
  })

  it('reports the user-changeable caps as positive whole numbers', () => {
    for (const bad of [0, -1, 1.5]) {
      expect(
        DotHelloResultSchema.safeParse({
          ...hello,
          limits: { ...hello.limits, maxSubmissionsPerMinute: bad }
        }).success
      ).toBe(false)
    }
  })

  it('claims no connection state: the interface cannot know whether a dot is linked', () => {
    for (const field of ['connected', 'online', 'connection', 'approved']) {
      expect(DotHelloResultSchema.safeParse({ ...hello, [field]: true }).success).toBe(false)
    }
  })
})

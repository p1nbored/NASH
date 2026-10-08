import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DOT_DECISION_DECIDERS,
  DOT_DECISION_STATUSES,
  DotDecisionViewSchema
} from '../../../../shared/dot-ingress/dot-ingress-decision'
import {
  DOT_DECISION_SUMMARY_MAX_CHARS,
  DOT_REQUEST_ACCESS_LEVELS,
  DOT_SUBMISSION_FAILURES
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import { DotRequestViewSchema } from '../../../../shared/dot-ingress/dot-ingress-request'
import { DotIngressSettingsViewSchema } from '../../../../shared/dot-ingress/dot-ingress-settings'
import { DOT_REQUEST_STATUS_TEXT } from '../../../../shared/dot-ingress/dot-ingress-status-text'
import { OrchestrationDb } from './orchestration-db'
import {
  PERMISSION_DECISION_DECIDERS,
  PERMISSION_DECISION_STATUSES,
  PERMISSION_SUMMARY_MAX_CHARS,
  WORKFLOW_RUN_ACCESS_LEVELS
} from './autopilot-run-schema-definition'
import { seedRunWithRunningOwner } from './autopilot-runtime.test-fixture'
import {
  toDotDecisionView,
  toDotRequestView,
  toDotSettingsView,
  toDotWorkspaceViews
} from './dot-ingress-projection'
import { getDotIngressSettingsStore } from './dot-ingress-settings-store'
import { getDotIngressStore, type DotRequestRecord } from './dot-ingress-store'
import { getPermissionDecisionStore } from './permission-decision-store'
import type { PermissionDecisionRecord } from './permission-decision-record'
import {
  FIXTURE_BINDING,
  FIXTURE_OBJECTIVE,
  FIXTURE_WORKSPACE_ID,
  enableFixtureInterface,
  errorCodeOf,
  fixtureTime,
  fixtureUuid,
  submitInput
} from './dot-ingress.test-fixture'

// FIXTURE_ONLY: obviously fake credential shape, used to prove masking.
const FAKE_BEARER_SECRET = 'x'.repeat(24)

const record: DotRequestRecord = {
  dotRequestId: fixtureUuid(7),
  sequence: 7,
  revision: 1,
  state: 'received',
  workspaceRef: 'dws_0123456789abcdef01234567',
  requestedAccess: 'workspace_write',
  replyCorrelationId: 'conv-1',
  workbenchRequestId: null,
  failureCode: null,
  createdAt: fixtureTime(),
  updatedAt: fixtureTime(),
  endedAt: null
}
const submitted: DotRequestRecord = {
  ...record,
  state: 'submitted',
  revision: 2,
  workbenchRequestId: 'wb-secret-1'
}

describe('dot-facing request view', () => {
  it('shows a received request with its constant status text and a not-started run', () => {
    const view = toDotRequestView(record)
    expect(DotRequestViewSchema.safeParse(view).success).toBe(true)
    expect(view).toEqual({
      contractVersion: 3,
      dotRequestId: record.dotRequestId,
      sequence: 7,
      revision: 1,
      state: 'received',
      workspaceRef: record.workspaceRef,
      requestedAccess: record.requestedAccess,
      reply: { correlationId: 'conv-1' },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      statusText: DOT_REQUEST_STATUS_TEXT.received,
      result: null,
      artifacts: [],
      run: { state: 'not_started', blocker: null }
    })
  })

  it('keeps a received request not-started whatever run the caller supplies: no run can exist yet', () => {
    expect(toDotRequestView(record, { state: 'active', blocker: null }).run).toEqual({
      state: 'not_started',
      blocker: null
    })
  })

  it('maps a missing correlation id to a null reply', () => {
    expect(toDotRequestView({ ...record, replyCorrelationId: null }).reply).toBeNull()
  })

  it('shows a submitted request with the coarse run the caller supplies, or not_started', () => {
    expect(toDotRequestView(submitted).run).toEqual({ state: 'not_started', blocker: null })
    expect(toDotRequestView(submitted, { state: 'active', blocker: null }).run).toEqual({
      state: 'active',
      blocker: null
    })
    expect(toDotRequestView(submitted, { state: 'blocked', blocker: 'launch_failed' }).run).toEqual(
      {
        state: 'blocked',
        blocker: 'launch_failed'
      }
    )
  })

  it('keeps the requested access but never exposes the Workbench request id', () => {
    const text = JSON.stringify(toDotRequestView(submitted, { state: 'active', blocker: null }))
    expect(text).not.toContain('wb-secret-1')
    expect(text).toContain('workspace_write')
  })

  it.each(['canceled', 'failed'] as const)(
    'shows a %s request with no run even if the caller supplies one',
    (state) => {
      const ended: DotRequestRecord = {
        ...record,
        state,
        failureCode: state === 'failed' ? DOT_SUBMISSION_FAILURES[0] : null,
        endedAt: fixtureTime(30)
      }
      const view = toDotRequestView(ended, { state: 'active', blocker: null })
      expect(view.state).toBe(state)
      expect(view.run).toBeNull()
      expect(view.statusText).toBe(DOT_REQUEST_STATUS_TEXT[state])
    }
  )

  it('fails closed on a record that cannot be a valid view', () => {
    expect(errorCodeOf(() => toDotRequestView({ ...record, workspaceRef: 'repo::/x' }))).toBe(
      'dot_recovery_required'
    )
  })

  describe('from real rows, no dot view carries the objective or the workspace', () => {
    let owner: OrchestrationDb
    beforeEach(() => {
      owner = new OrchestrationDb(':memory:')
    })
    afterEach(() => owner.close())

    it('is clean in every state a request can reach', () => {
      const ref = enableFixtureInterface(owner)
      getDotIngressSettingsStore(owner).setRateLimits({
        ratePerMinute: 60,
        ratePerUtcDay: 1000,
        timestamp: fixtureTime(1)
      })
      const ingress = getDotIngressStore(owner)
      const objectiveFor = (n: number) => `${FIXTURE_OBJECTIVE} Variant ${n}.`
      const submitVariant = (n: number): string =>
        ingress.submit(
          submitInput(ref, { objective: objectiveFor(n), idempotencyKey: fixtureUuid(n) })
        ).record.dotRequestId
      const receivedId = submitVariant(1)
      const submittedId = submitVariant(2)
      const canceledId = submitVariant(3)
      const failedId = submitVariant(4)
      const ids = [receivedId, submittedId, canceledId, failedId]
      ingress.linkSubmitted({
        dotRequestId: submittedId,
        workbenchRequestId: 'wb-1',
        timestamp: fixtureTime(20)
      })
      ingress.linkSubmitted({
        dotRequestId: canceledId,
        workbenchRequestId: 'wb-2',
        timestamp: fixtureTime(20)
      })
      ingress.cancel({ dotRequestId: canceledId, timestamp: fixtureTime(21) })
      ingress.markFailed({
        dotRequestId: failedId,
        failure: 'workspace_unavailable',
        timestamp: fixtureTime(22)
      })

      const views = ids.map((id) => toDotRequestView(ingress.get(id)))
      expect(views.map((view) => view.state)).toEqual([
        'received',
        'submitted',
        'canceled',
        'failed'
      ])
      expect(views[0]?.dotRequestId).toBe(receivedId)
      const text = JSON.stringify(views)
      for (const n of [1, 2, 3, 4]) {
        expect(text).not.toContain(objectiveFor(n))
      }
      expect(text).not.toContain(FIXTURE_OBJECTIVE)
      expect(text).not.toContain(FIXTURE_WORKSPACE_ID)
      expect(text).not.toContain('fixture-repo')
      expect(text).not.toContain('wb-1')
      expect(text).not.toContain('wb-2')
      expect(text).not.toContain(FIXTURE_BINDING)
    })
  })
})

describe('dot-facing workspace views and desktop settings view', () => {
  const enabled = {
    workspaceRef: 'dws_0123456789abcdef01234567',
    workspaceId: FIXTURE_WORKSPACE_ID,
    workspaceBinding: FIXTURE_BINDING,
    label: 'fixture-repo',
    enabled: true,
    createdAt: fixtureTime(),
    updatedAt: fixtureTime()
  }
  const disabled = { ...enabled, workspaceRef: 'dws_aaaaaaaaaaaaaaaaaaaaaaaa', enabled: false }

  it('lists enabled workspaces by opaque reference and label only', () => {
    const views = toDotWorkspaceViews([
      { ...enabled, maxAccess: 'read_only' },
      { ...disabled, maxAccess: 'read_only' }
    ])
    expect(views).toEqual([
      { workspaceRef: enabled.workspaceRef, label: 'fixture-repo', maxAccess: 'read_only' }
    ])
    const text = JSON.stringify(views)
    expect(text).not.toContain(FIXTURE_WORKSPACE_ID)
    expect(text).not.toContain(FIXTURE_BINDING)
  })

  it('gives the desktop the workspace id and the caps, and never claims a connection', () => {
    const view = toDotSettingsView(
      { enabled: true, ratePerMinute: 3, ratePerUtcDay: 40, updatedAt: fixtureTime() },
      [enabled, disabled]
    )
    expect(DotIngressSettingsViewSchema.safeParse(view).success).toBe(true)
    expect(view.connection).toBe('not_connected')
    expect(view.rateLimits).toEqual({ ratePerMinute: 3, ratePerUtcDay: 40 })
    expect(view.workspaces).toEqual([
      {
        workspaceRef: enabled.workspaceRef,
        workspaceId: FIXTURE_WORKSPACE_ID,
        label: 'fixture-repo',
        enabled: true
      },
      {
        workspaceRef: disabled.workspaceRef,
        workspaceId: FIXTURE_WORKSPACE_ID,
        label: 'fixture-repo',
        enabled: false
      }
    ])
    expect(JSON.stringify(view)).not.toContain(FIXTURE_BINDING)
  })

  it('shows the interface as off, with the default caps, before the user ever switched it', () => {
    const view = toDotSettingsView(
      { enabled: false, ratePerMinute: 6, ratePerUtcDay: 100, updatedAt: null },
      []
    )
    expect(view).toEqual({
      enabled: false,
      connection: 'not_connected',
      rateLimits: { ratePerMinute: 6, ratePerUtcDay: 100 },
      updatedAt: null,
      workspaces: []
    })
  })
})

describe('dot-facing decision view (D-017: redacted summary only)', () => {
  const DOT_REQUEST_ID = fixtureUuid(7)
  const decision: PermissionDecisionRecord = {
    decisionId: fixtureUuid(40),
    runId: 'run_fixture01',
    ownerId: 'owner_fixture01',
    agentId: 'agent_7',
    toolName: 'Bash',
    summary: 'Bash: git status',
    requestSha256: 'a'.repeat(64),
    status: 'pending',
    decidedBy: null,
    createdAt: fixtureTime(),
    deadlineAt: fixtureTime(240),
    decidedAt: null
  }

  it('keeps the tool, agent, one-line summary, status and times, and drops every internal id and the hash', () => {
    const view = toDotDecisionView(decision, DOT_REQUEST_ID, true)
    expect(DotDecisionViewSchema.safeParse(view).success).toBe(true)
    expect(view).toEqual({
      decisionId: decision.decisionId,
      dotRequestId: DOT_REQUEST_ID,
      dotMayAllow: true,
      toolName: 'Bash',
      agentId: 'agent_7',
      summary: 'Bash: git status',
      status: 'pending',
      decidedBy: null,
      createdAt: fixtureTime(),
      deadlineAt: fixtureTime(240),
      decidedAt: null
    })
    const text = JSON.stringify(view)
    for (const hidden of ['run_fixture01', 'owner_fixture01', 'a'.repeat(64)]) {
      expect(text).not.toContain(hidden)
    }
  })

  it('copies named fields only: a smuggled tool input or file contents never reaches the view', () => {
    const smuggled = {
      ...decision,
      toolInput: 'FILE CONTENTS: password list',
      contents: 'FILE CONTENTS'
    }
    const text = JSON.stringify(toDotDecisionView(smuggled, DOT_REQUEST_ID, true))
    expect(text).not.toContain('FILE CONTENTS')
    expect(text).not.toContain('toolInput')
  })

  it('masks a credential that is still in the stored summary', () => {
    const view = toDotDecisionView(
      {
        ...decision,
        summary: `curl -H "Authorization: Bearer ${FAKE_BEARER_SECRET}" https://example.test`
      },
      DOT_REQUEST_ID,
      true
    )
    expect(view.summary).not.toContain(FAKE_BEARER_SECRET)
    expect(view.summary).toContain('[redacted]')
  })

  it('cuts an overlong stored summary to 500 characters and flattens line breaks', () => {
    const long = toDotDecisionView(
      { ...decision, summary: `${'a'.repeat(300)}\n${'b'.repeat(400)}` },
      DOT_REQUEST_ID,
      true
    )
    expect(Array.from(long.summary)).toHaveLength(DOT_DECISION_SUMMARY_MAX_CHARS)
    expect(long.summary).not.toMatch(/[\n\r]/)
    const emoji = toDotDecisionView(
      { ...decision, summary: '\u{1F600}'.repeat(600) },
      DOT_REQUEST_ID,
      true
    )
    expect(Array.from(emoji.summary)).toHaveLength(DOT_DECISION_SUMMARY_MAX_CHARS)
    expect(DotDecisionViewSchema.safeParse(emoji).success).toBe(true)
  })

  it('refuses a request id that is not a dot request uuid', () => {
    expect(errorCodeOf(() => toDotDecisionView(decision, 'request-1', true))).toBe(
      'dot_recovery_required'
    )
  })

  it.each([
    ['allowed', 'dot'],
    ['denied', 'desktop'],
    ['answered_in_terminal', 'terminal']
  ] as const)('shows a %s decision decided by %s', (status, decidedBy) => {
    const view = toDotDecisionView(
      { ...decision, status, decidedBy, decidedAt: fixtureTime(60) },
      DOT_REQUEST_ID,
      true
    )
    expect(view).toMatchObject({ status, decidedBy, decidedAt: fixtureTime(60) })
  })

  it('keeps the contract constants in step with the stores', () => {
    expect(DOT_DECISION_SUMMARY_MAX_CHARS).toBe(PERMISSION_SUMMARY_MAX_CHARS)
    expect([...DOT_DECISION_STATUSES].sort()).toEqual([...PERMISSION_DECISION_STATUSES].sort())
    expect([...DOT_DECISION_DECIDERS].sort()).toEqual([...PERMISSION_DECISION_DECIDERS].sort())
    expect([...DOT_REQUEST_ACCESS_LEVELS]).toEqual([...WORKFLOW_RUN_ACCESS_LEVELS])
  })

  describe('from real permission decisions', () => {
    let owner: OrchestrationDb
    beforeEach(() => {
      owner = new OrchestrationDb(':memory:')
    })
    afterEach(() => owner.close())

    it('carries the redacted summary of a stored decision and nothing from any request', () => {
      const ref = enableFixtureInterface(owner)
      const ingress = getDotIngressStore(owner)
      const requestId = ingress.submit(
        submitInput(ref, { objective: 'Private objective about the ACME merger.' })
      ).record.dotRequestId
      const other = ingress.submit(
        submitInput(ref, {
          objective: 'A different private objective.',
          idempotencyKey: fixtureUuid(2),
          timestamp: fixtureTime(11)
        })
      ).record.dotRequestId
      const { ownerId } = seedRunWithRunningOwner(owner)
      const store = getPermissionDecisionStore(owner)
      const created = store.create({
        runId: 'run_fixture01',
        ownerId,
        agentId: 'agent_1',
        toolName: 'Edit',
        summary: 'Edit: src/billing/invoice.ts',
        requestSha256: 'b'.repeat(64),
        deadlineAt: fixtureTime(240),
        timestamp: fixtureTime(10)
      })
      const view = toDotDecisionView(created, requestId, true)
      expect(view.summary).toBe('Edit: src/billing/invoice.ts')
      const answered = store.answer({
        decisionId: created.decisionId,
        decision: 'allowed',
        decidedBy: 'dot',
        timestamp: fixtureTime(20)
      })
      expect(answered.outcome).toBe('decided')
      const after = toDotDecisionView(
        answered.outcome === 'decided' ? answered.record : created,
        requestId,
        true
      )
      expect(after).toMatchObject({ status: 'allowed', decidedBy: 'dot' })
      const text = JSON.stringify([view, after])
      expect(text).not.toContain('ACME')
      expect(text).not.toContain('different private objective')
      expect(text).not.toContain(other)
    })
  })
})

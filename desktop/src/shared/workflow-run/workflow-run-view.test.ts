import { describe, expect, it } from 'vitest'
import {
  RunMessageSendResultSchema,
  WORKFLOW_RUN_LIST_MAX_LIMIT,
  WorkflowRunListResultSchema,
  WorkflowRunShowResultSchema,
  WorkflowRunStopResultSchema,
  WorkflowRunViewSchema,
  type WorkflowRunView
} from './workflow-run-view'

// FIXTURE_ONLY: synthetic ids and hashes; no real run.
const RUN: WorkflowRunView = {
  runId: 'run_fixture01',
  requestId: '8f18f989-8a86-423e-8e45-3416e01a14d2',
  origin: 'desktop',
  workspaceId: 'repo::C:\\work\\repo',
  objective: 'Inspect this change.',
  status: 'active',
  revision: 2,
  requestedAccess: 'read_only',
  deliverableLanguage: null,
  routingTable: { version: 1, sha256: 'b'.repeat(64) },
  coordinator: { model: 'claude-opus-5-5', effort: 'max' },
  endReason: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:01.000Z',
  endedAt: null,
  primary: {
    generation: 1,
    state: 'running',
    permissionMode: 'manual',
    model: 'claude-opus-5-5',
    effort: 'max',
    paneKey: 'tab_primary:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    endReason: null,
    startedAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:01.000Z',
    endedAt: null,
    live: { kind: 'live', activity: 'idle' }
  }
}

describe('WorkflowRunViewSchema', () => {
  it('accepts a launched run with its primary session', () => {
    expect(WorkflowRunViewSchema.parse(RUN)).toEqual(RUN)
  })

  it('accepts a run with no owner record and a stored-only primary', () => {
    expect(WorkflowRunViewSchema.safeParse({ ...RUN, primary: null }).success).toBe(true)
    const stored = { ...RUN, primary: { ...RUN.primary, live: null } }
    expect(WorkflowRunViewSchema.safeParse(stored).success).toBe(true)
  })

  it('refuses unknown keys, so no internal field can ride along', () => {
    expect(
      WorkflowRunViewSchema.safeParse({ ...RUN, workspaceBinding: 'a'.repeat(64) }).success
    ).toBe(false)
    const withToken = { ...RUN, primary: { ...RUN.primary, launchTokenSha256: 'a'.repeat(64) } }
    expect(WorkflowRunViewSchema.safeParse(withToken).success).toBe(false)
  })

  it('never carries a terminal handle in the live status', () => {
    const live = { kind: 'live', activity: 'idle', handle: 'term_primary_a' }
    const withHandle = { ...RUN, primary: { ...RUN.primary, live } }
    expect(WorkflowRunViewSchema.safeParse(withHandle).success).toBe(false)
  })

  it.each([
    ['status', { status: 'routed' }],
    ['origin', { origin: 'mobile' }],
    ['access', { requestedAccess: 'admin' }],
    ['end reason', { endReason: 'Free text with spaces' }],
    ['coordinator effort', { coordinator: { model: 'claude-opus-5-5', effort: 'extreme' } }]
  ])('refuses an unknown %s', (_name, change) => {
    expect(WorkflowRunViewSchema.safeParse({ ...RUN, ...change }).success).toBe(false)
  })

  it.each(['ultra', 'none', 'minimal'])('shows a coordinator effort of %s (D-027)', (effort) => {
    const run = { ...RUN, coordinator: { model: 'claude-opus-5-5', effort } }
    expect(WorkflowRunViewSchema.safeParse(run).success).toBe(true)
  })

  it('reads every live kind the primary status reader reports', () => {
    const kinds = [
      { kind: 'live', activity: 'dialog_open' },
      { kind: 'agent_absent' },
      { kind: 'unverifiable', reason: 'incarnation_mismatch' },
      { kind: 'starting' },
      { kind: 'ended', state: 'exited' }
    ]
    for (const live of kinds) {
      const view = { ...RUN, primary: { ...RUN.primary, live } }
      expect(WorkflowRunViewSchema.safeParse(view).success, JSON.stringify(live)).toBe(true)
    }
  })
})

describe('run method results', () => {
  it('bounds a list page', () => {
    const runs = Array.from({ length: WORKFLOW_RUN_LIST_MAX_LIMIT + 1 }, () => RUN)
    expect(WorkflowRunListResultSchema.safeParse({ runs, hasMore: false }).success).toBe(false)
    expect(WorkflowRunListResultSchema.parse({ runs: [RUN], hasMore: true }).runs).toHaveLength(1)
  })

  it('shows one run and reports whether a stop changed it', () => {
    expect(WorkflowRunShowResultSchema.parse({ run: RUN }).run.runId).toBe(RUN.runId)
    expect(WorkflowRunStopResultSchema.parse({ run: RUN, changed: true }).changed).toBe(true)
  })

  it('reports a message outcome as delivered, queued or refused with a reason code', () => {
    const queued = {
      outcome: 'queued',
      reason: 'agent_busy',
      messageId: 'message_fixture01',
      state: 'received',
      duplicate: false
    }
    expect(RunMessageSendResultSchema.parse(queued)).toEqual(queued)
    const refused = { ...queued, outcome: 'refused', reason: 'run_not_active', messageId: null }
    expect(RunMessageSendResultSchema.parse({ ...refused, state: null })).toMatchObject({
      outcome: 'refused'
    })
    expect(RunMessageSendResultSchema.safeParse({ ...queued, outcome: 'sent' }).success).toBe(false)
    expect(RunMessageSendResultSchema.safeParse({ ...queued, text: 'echo' }).success).toBe(false)
  })
})

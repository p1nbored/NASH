import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DOT_REQUEST_STATUS_TEXT } from '../dot-ingress/dot-ingress-status-text'
import {
  DOT_REMOTE_EVENT_KINDS,
  DOT_REMOTE_EVENT_VARIANTS,
  DotRemoteEventBatchResultSchema,
  DotRemoteEventBatchSchema,
  DotRemoteEventSchema
} from './dot-remote-events'
import { DOT_REMOTE_EVENT_BATCH_MAX } from './dot-remote-limits'
import { closedObjectViolations, propertyNames } from './dot-remote-json-schema-walk.test-fixture'

const REQUEST_ID = '30000000-0000-4000-8000-000000000001'
const DECISION_ID = '40000000-0000-4000-8000-000000000001'
const MESSAGE_ID = '50000000-0000-4000-8000-000000000001'
const EVENT_ID = '60000000-0000-4000-8000-000000000001'
const VALIDATION_ID = 'validation_70000000-0000-4000-8000-000000000001'
const AT = '2026-10-05T12:00:05.000Z'

function decisionView(status: string, decidedBy: string | null) {
  return {
    decisionId: DECISION_ID,
    dotRequestId: REQUEST_ID,
    toolName: 'Bash',
    agentId: null,
    summary: 'Bash: git status',
    status,
    decidedBy,
    createdAt: AT,
    deadlineAt: '2026-10-05T12:04:05.000Z',
    decidedAt: decidedBy === null ? null : '2026-10-05T12:00:30.000Z',
    dotMayAllow: false
  }
}

const SAMPLE_DATA: Record<string, Record<string, unknown>> = {
  request_status: {
    state: 'submitted',
    statusText: DOT_REQUEST_STATUS_TEXT.submitted,
    run: { state: 'active', blocker: null }
  },
  permission_prompt_opened: decisionView('pending', null),
  permission_prompt_closed: decisionView('denied', 'dot'),
  message_outcome: { messageId: MESSAGE_ID, outcome: 'queued', reason: 'agent_busy' },
  validation_result: { verdict: 'pass', line: '2 checks: 2 passed, 0 failed, 0 undecided.' },
  deliverable_summary: {
    summary: 'The report lists four open issues and one stale branch.',
    artifacts: [
      { artifactId: 'art_0123456789abcdef01234567', sizeBytes: 2048, sha256: 'c'.repeat(64) }
    ]
  },
  validation_decision_pending: {
    validationId: VALIDATION_ID,
    dotRequestId: REQUEST_ID,
    title: 'Summarize the open issues',
    reason: 'primary_did_task',
    summary: 'Listed four open issues and their owners.',
    summaryWithheld: false,
    createdAt: AT
  },
  validation_decision_settled: {
    validationId: VALIDATION_ID,
    outcome: 'waived',
    decidedAt: '2026-10-05T12:01:00.000Z'
  }
}

function event(kind: string, data = SAMPLE_DATA[kind], overrides: Record<string, unknown> = {}) {
  return {
    eventId: EVENT_ID,
    kind,
    dotRequestId: REQUEST_ID,
    sourceRevision: 1,
    at: AT,
    data,
    ...overrides
  }
}

const FORBIDDEN_FIELD =
  /^(path|paths|relativePath|filePath|file_path|cwd|content|contents|body|output|stdout|stderr|terminal|transcript|input|toolInput|tool_input|command|rows|row|stack|stackTrace|error|objective|text|model|effort|route|label)$/i

describe('event allowlist (RG6)', () => {
  it('allows exactly eight event kinds', () => {
    expect(DOT_REMOTE_EVENT_KINDS).toEqual([
      'request_status',
      'permission_prompt_opened',
      'permission_prompt_closed',
      'message_outcome',
      'validation_result',
      'deliverable_summary',
      'validation_decision_pending',
      'validation_decision_settled'
    ])
    expect(Object.keys(DOT_REMOTE_EVENT_VARIANTS)).toEqual([...DOT_REMOTE_EVENT_KINDS])
    expect(DotRemoteEventSchema.safeParse(event('task_progress', {})).success).toBe(false)
  })

  it.each(DOT_REMOTE_EVENT_KINDS)('accepts a %s event with its own schema', (kind) => {
    expect(DotRemoteEventSchema.safeParse(event(kind)).success).toBe(true)
    expect(DOT_REMOTE_EVENT_VARIANTS[kind].safeParse(event(kind)).success).toBe(true)
  })

  it.each(DOT_REMOTE_EVENT_KINDS)('refuses an unknown key on the %s envelope', (kind) => {
    expect(DotRemoteEventSchema.safeParse({ ...event(kind), runRef: 'x' }).success).toBe(false)
  })

  it.each(DOT_REMOTE_EVENT_KINDS)('refuses an unknown key inside %s data', (kind) => {
    const data = { ...SAMPLE_DATA[kind], detail: 'x' }
    expect(DotRemoteEventSchema.safeParse(event(kind, data)).success).toBe(false)
  })

  it('refuses unknown keys in the nested run and artifact objects', () => {
    const run = {
      ...SAMPLE_DATA.request_status,
      run: { state: 'active', blocker: null, task: 't1' }
    }
    expect(DotRemoteEventSchema.safeParse(event('request_status', run)).success).toBe(false)
    const artifact = {
      artifactId: 'art_0123456789abcdef01234567',
      sizeBytes: 1,
      sha256: 'c'.repeat(64),
      path: 'a.md'
    }
    const deliverable = { ...SAMPLE_DATA.deliverable_summary, artifacts: [artifact] }
    expect(DotRemoteEventSchema.safeParse(event('deliverable_summary', deliverable)).success).toBe(
      false
    )
  })

  it('closes every object of every event schema', () => {
    for (const [kind, schema] of Object.entries(DOT_REMOTE_EVENT_VARIANTS)) {
      expect(closedObjectViolations(z.toJSONSchema(schema, { io: 'input' })), kind).toEqual([])
    }
  })

  it('has no field for paths, contents, raw tool input, terminal or executor output, rows or stacks', () => {
    for (const [kind, schema] of Object.entries(DOT_REMOTE_EVENT_VARIANTS)) {
      const names = propertyNames(z.toJSONSchema(schema))
      expect(
        names.filter((name) => FORBIDDEN_FIELD.test(name)),
        kind
      ).toEqual([])
    }
  })
})

describe('event data', () => {
  it('keeps request status to the coarse v2 run projection', () => {
    const variant = DOT_REMOTE_EVENT_VARIANTS.request_status
    for (const extra of [{ sequence: 1 }, { result: null }, { artifacts: [] }, { reply: null }]) {
      const data = { ...SAMPLE_DATA.request_status, ...extra }
      expect(variant.safeParse(event('request_status', data)).success).toBe(false)
    }
    const blocked = {
      state: 'submitted',
      statusText: DOT_REQUEST_STATUS_TEXT.submitted,
      run: { state: 'blocked', blocker: 'other' }
    }
    expect(variant.safeParse(event('request_status', blocked)).success).toBe(true)
    const canceled = { state: 'canceled', statusText: DOT_REQUEST_STATUS_TEXT.canceled, run: null }
    expect(variant.safeParse(event('request_status', canceled)).success).toBe(true)
    const wrongText = { ...canceled, statusText: 'Stopped by the agent.' }
    expect(variant.safeParse(event('request_status', wrongText)).success).toBe(false)
  })

  it('keeps an opened prompt pending and a closed prompt decided', () => {
    const opened = DOT_REMOTE_EVENT_VARIANTS.permission_prompt_opened
    const closed = DOT_REMOTE_EVENT_VARIANTS.permission_prompt_closed
    expect(
      opened.safeParse(event('permission_prompt_opened', decisionView('denied', 'dot'))).success
    ).toBe(false)
    expect(
      closed.safeParse(event('permission_prompt_closed', decisionView('pending', null))).success
    ).toBe(false)
    const expired = { ...decisionView('expired', null), decidedAt: AT }
    expect(closed.safeParse(event('permission_prompt_closed', expired)).success).toBe(true)
  })

  it('caps the redacted prompt summary at 500 characters on one line', () => {
    const long = { ...decisionView('pending', null), summary: `Bash: ${'a'.repeat(495)}` }
    expect(DotRemoteEventSchema.safeParse(event('permission_prompt_opened', long)).success).toBe(
      false
    )
    const twoLines = { ...decisionView('pending', null), summary: 'Bash: ls\nrm -rf x' }
    expect(
      DotRemoteEventSchema.safeParse(event('permission_prompt_opened', twoLines)).success
    ).toBe(false)
  })

  it('ties a prompt event to the request it belongs to', () => {
    const other = {
      ...decisionView('pending', null),
      dotRequestId: '30000000-0000-4000-8000-000000000009'
    }
    expect(DotRemoteEventSchema.safeParse(event('permission_prompt_opened', other)).success).toBe(
      false
    )
  })

  it('names a refused message reason', () => {
    const refused = { messageId: MESSAGE_ID, outcome: 'refused', reason: null }
    expect(DotRemoteEventSchema.safeParse(event('message_outcome', refused)).success).toBe(false)
    const delivered = { messageId: MESSAGE_ID, outcome: 'delivered', reason: null }
    expect(DotRemoteEventSchema.safeParse(event('message_outcome', delivered)).success).toBe(true)
  })

  it('caps the validation record at one English line of 300 characters', () => {
    const line = (text: string) => event('validation_result', { verdict: 'fail', line: text })
    expect(DotRemoteEventSchema.safeParse(line('a'.repeat(300))).success).toBe(true)
    expect(DotRemoteEventSchema.safeParse(line('a'.repeat(301))).success).toBe(false)
    expect(DotRemoteEventSchema.safeParse(line('First line.\nSecond line.')).success).toBe(false)
    expect(DotRemoteEventSchema.safeParse(line('検証に失敗しました')).success).toBe(false)
    const verdict = event('validation_result', { verdict: 'approved', line: 'Fine.' })
    expect(DotRemoteEventSchema.safeParse(verdict).success).toBe(false)
  })

  it('caps the deliverable summary at 2,000 characters and names artifacts by opaque id only', () => {
    const summary = (text: string) => event('deliverable_summary', { summary: text, artifacts: [] })
    expect(DotRemoteEventSchema.safeParse(summary('a'.repeat(2000))).success).toBe(true)
    expect(DotRemoteEventSchema.safeParse(summary('a'.repeat(2001))).success).toBe(false)
    const pathId = { artifactId: 'docs/report.md', sizeBytes: 1, sha256: 'c'.repeat(64) }
    const deliverable = { summary: 'Done.', artifacts: [pathId] }
    expect(DotRemoteEventSchema.safeParse(event('deliverable_summary', deliverable)).success).toBe(
      false
    )
  })

  it('requires a positive sourceRevision', () => {
    for (const sourceRevision of [0, -1, 1.5]) {
      expect(
        DotRemoteEventSchema.safeParse(event('request_status', undefined, { sourceRevision }))
          .success
      ).toBe(false)
    }
  })
})

describe('event batch', () => {
  it('carries the pairing generation and at most the batch maximum', () => {
    const events = Array.from({ length: DOT_REMOTE_EVENT_BATCH_MAX }, () => event('request_status'))
    expect(DotRemoteEventBatchSchema.safeParse({ generation: 1, events }).success).toBe(true)
    const tooMany = [...events, event('request_status')]
    expect(DotRemoteEventBatchSchema.safeParse({ generation: 1, events: tooMany }).success).toBe(
      false
    )
    expect(DotRemoteEventBatchSchema.safeParse({ generation: 1, events: [] }).success).toBe(false)
  })

  it('answers one status per event and the applied revision per request', () => {
    const result = {
      results: [
        { eventId: EVENT_ID, status: 'applied' },
        { eventId: EVENT_ID, status: 'duplicate' },
        { eventId: EVENT_ID, status: 'stale' },
        { eventId: EVENT_ID, status: 'conflict' },
        { eventId: EVENT_ID, status: 'unknown_request' }
      ],
      cursors: [{ dotRequestId: REQUEST_ID, appliedRevision: 4 }]
    }
    expect(DotRemoteEventBatchResultSchema.safeParse(result).success).toBe(true)
    const odd = { ...result, results: [{ eventId: EVENT_ID, status: 'ignored' }] }
    expect(DotRemoteEventBatchResultSchema.safeParse(odd).success).toBe(false)
  })
})

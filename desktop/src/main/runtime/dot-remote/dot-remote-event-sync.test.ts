import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DOT_RUN_STATES } from '../../../shared/dot-ingress/dot-ingress-request'
import { DOT_REQUEST_STATUS_TEXT } from '../../../shared/dot-ingress/dot-ingress-status-text'
import { DotDecisionViewSchema } from '../../../shared/dot-ingress/dot-ingress-decision'
import {
  decisionView,
  messageId,
  requestId
} from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { DotRemoteRequestSnapshot } from './dot-remote-event-source'
import { createDotRemoteEventSync } from './dot-remote-event-sync'
import { DOT_REMOTE_DELIVERABLE_FALLBACK } from './dot-remote-event-texts'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import { getDotRemoteRequestStore } from './dot-remote-request-store'
import { ensureDotRemoteSchema } from './dot-remote-schema'
import { fixtureClock } from './dot-remote.test-fixture'

type DotRunState = (typeof DOT_RUN_STATES)[number]
const view = (...args: Parameters<typeof decisionView>) =>
  DotDecisionViewSchema.parse(decisionView(...args))
const SUBMIT_ITEM = '10000000-0000-4000-8000-000000000001'
const active = (state: DotRunState = 'active') => ({
  state: 'submitted' as const,
  statusText: DOT_REQUEST_STATUS_TEXT.submitted,
  run: { state, blocker: null }
})

function snapshot(overrides: Partial<DotRemoteRequestSnapshot> = {}): DotRemoteRequestSnapshot {
  return {
    status: active(),
    prompts: [],
    messages: [],
    validations: [],
    deliverable: null,
    validationDecisions: [],
    awaitsValidationDecision: false,
    ...overrides
  }
}

describe('dot remote event sync', () => {
  let owner: OrchestrationDb
  let clock: ReturnType<typeof fixtureClock>
  let current: DotRemoteRequestSnapshot | null
  let ids: number
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ensureDotRemoteSchema(owner.db)
    getDotRemoteRequestStore(owner).track({
      dotRequestId: requestId(1),
      submitItemId: SUBMIT_ITEM,
      generation: 1,
      timestamp: '2026-10-05T12:00:00.000Z'
    })
    clock = fixtureClock(5)
    current = snapshot()
    ids = 0
  })
  afterEach(() => owner.close())

  function syncWith(source = { snapshot: vi.fn(() => current) }) {
    return createDotRemoteEventSync({
      owner,
      source,
      now: clock.now,
      newEventId: () => `60000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
      log: vi.fn()
    })
  }

  const pending = () => getDotRemoteOutboxStore(owner).pending(1, 50)

  it('records the request status once and again only when it changes', () => {
    const sync = syncWith()
    expect(sync.run()).toEqual({ busy: true, recorded: 1 })
    expect(sync.run()).toEqual({ busy: true, recorded: 0 })
    current = snapshot({ status: active('completing') })
    sync.run()
    expect(pending().map((event) => [event.kind, event.sourceRevision])).toEqual([
      ['request_status', 1],
      ['request_status', 2]
    ])
    expect(pending()[0]).toEqual({
      eventId: '60000000-0000-4000-8000-000000000001',
      kind: 'request_status',
      dotRequestId: requestId(1),
      sourceRevision: 1,
      at: '2026-10-05T12:00:05.000Z',
      data: active()
    })
  })

  it('opens a prompt once and closes it once it is decided', () => {
    const sync = syncWith()
    current = snapshot({ prompts: [view('Bash', 'Bash: git status', 4, false)] })
    sync.run()
    current = snapshot({
      prompts: [view('Bash', 'Bash: git status', 4, false, { status: 'denied', by: 'dot', at: 6 })]
    })
    sync.run()
    sync.run()
    expect(pending().map((event) => event.kind)).toEqual([
      'request_status',
      'permission_prompt_opened',
      'permission_prompt_closed'
    ])
  })

  it('reports a message outcome noted at its ack, then each later change from the run messages', () => {
    const sync = syncWith()
    sync.noteMessageOutcome(requestId(1), {
      messageId: messageId(2),
      outcome: 'queued',
      reason: 'dialog_open'
    })
    current = snapshot({
      messages: [{ messageId: messageId(2), outcome: 'delivered', reason: null }]
    })
    sync.run()
    const messages = pending().filter((event) => event.kind === 'message_outcome')
    expect(messages.map((event) => event.data)).toEqual([
      { messageId: messageId(2), outcome: 'queued', reason: 'dialog_open' },
      { messageId: messageId(2), outcome: 'delivered', reason: null }
    ])
  })

  it('passes the known message ids to the reader', () => {
    const source = { snapshot: vi.fn(() => current) }
    const sync = syncWith(source)
    sync.noteMessageOutcome(requestId(1), {
      messageId: messageId(2),
      outcome: 'queued',
      reason: null
    })
    sync.run()
    expect(source.snapshot).toHaveBeenCalledWith(requestId(1), {
      messageIds: [messageId(2)],
      validationIds: []
    })
  })

  it('reports a validation with its one-line record, or a fixed line when it does not fit', () => {
    const sync = syncWith()
    current = snapshot({
      validations: [
        {
          validationId: 'validation_a',
          verdict: 'pass',
          line: 'Validation passed: all 2 checks passed.'
        },
        { validationId: 'validation_b', verdict: 'fail', line: 'x'.repeat(400) }
      ]
    })
    sync.run()
    expect(
      pending()
        .filter((event) => event.kind === 'validation_result')
        .map((event) => event.data)
    ).toEqual([
      { verdict: 'pass', line: 'Validation passed: all 2 checks passed.' },
      { verdict: 'fail', line: 'Validation failed. The details are in the NASH app.' }
    ])
  })

  it('reports the deliverable with opaque artifact ids and stops following the request', () => {
    const sync = syncWith()
    current = snapshot({
      status: active('completed'),
      deliverable: {
        summary: 'Summarized the open issues in docs/plan.md.',
        artifacts: [{ artifactId: 'artifact_fixture_1', sizeBytes: 12, sha256: 'a'.repeat(64) }]
      }
    })
    expect(sync.run()).toEqual({ busy: false, recorded: 2 })
    const deliverable = pending().find((event) => event.kind === 'deliverable_summary')
    expect(deliverable?.data).toEqual({
      summary: 'Summarized the open issues in [path]',
      artifacts: [
        {
          artifactId: expect.stringMatching(/^art_[0-9a-f]{24}$/),
          sizeBytes: 12,
          sha256: 'a'.repeat(64)
        }
      ]
    })
    expect(JSON.stringify(pending())).not.toContain('artifact_fixture_1')
    expect(getDotRemoteRequestStore(owner).listOpen(10)).toEqual([])
  })

  it('uses the fixed line for a completed run without a summary', () => {
    const sync = syncWith()
    current = snapshot({
      status: active('completed'),
      deliverable: { summary: null, artifacts: [] }
    })
    sync.run()
    expect(pending().find((event) => event.kind === 'deliverable_summary')?.data).toEqual({
      summary: DOT_REMOTE_DELIVERABLE_FALLBACK,
      artifacts: []
    })
  })

  it('keeps following a finished run while one of its prompts is still pending', () => {
    const sync = syncWith()
    current = snapshot({
      status: active('failed'),
      prompts: [view('Bash', 'Bash: git status', 4, false)]
    })
    expect(sync.run().busy).toBe(true)
    expect(getDotRemoteRequestStore(owner).listOpen(10)).toHaveLength(1)
  })

  it('stops following a canceled request and reports idle', () => {
    const sync = syncWith()
    current = snapshot({
      status: { state: 'canceled', statusText: DOT_REQUEST_STATUS_TEXT.canceled, run: null }
    })
    expect(sync.run()).toEqual({ busy: false, recorded: 1 })
    expect(getDotRemoteRequestStore(owner).listOpen(10)).toEqual([])
  })

  describe('a facet that cannot be recorded', () => {
    const canceled = () =>
      snapshot({
        status: { state: 'canceled', statusText: DOT_REQUEST_STATUS_TEXT.canceled, run: null }
      })

    function loggedSync(log = vi.fn()) {
      const sync = createDotRemoteEventSync({
        owner,
        source: { snapshot: () => current },
        now: clock.now,
        newEventId: () => `60000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
        log
      })
      return { sync, log }
    }

    it('keeps following a finished request when its last event failed unexpectedly', () => {
      const { sync, log } = loggedSync()
      current = canceled()
      const enqueue = vi
        .spyOn(getDotRemoteOutboxStore(owner), 'enqueue')
        .mockImplementationOnce(() => {
          throw Object.assign(new Error('Fixture: disk I/O error at C:\\private\\nash.db'), {
            code: 'SQLITE_IOERR'
          })
        })
      expect(sync.run()).toEqual({ busy: false, recorded: 0 })
      expect(getDotRemoteRequestStore(owner).listOpen(10)).toHaveLength(1)
      expect(log).toHaveBeenCalledWith({
        event: 'dot_remote_event_unrecorded',
        code: 'SQLITE_IOERR',
        dotRequestId: requestId(1)
      })
      expect(JSON.stringify(log.mock.calls)).not.toContain('private')
      enqueue.mockRestore()
      expect(sync.run()).toEqual({ busy: false, recorded: 1 })
      expect(getDotRemoteRequestStore(owner).listOpen(10)).toEqual([])
    })

    it('still stops following a finished request whose event data is refused', () => {
      const { sync, log } = loggedSync()
      current = canceled()
      vi.spyOn(getDotRemoteOutboxStore(owner), 'enqueue').mockImplementationOnce(() => {
        throw new OrchestrationError('dot_remote_request_not_tracked', 'Fixture refusal.')
      })
      expect(sync.run()).toEqual({ busy: false, recorded: 0 })
      expect(getDotRemoteRequestStore(owner).listOpen(10)).toEqual([])
      expect(log).toHaveBeenCalledWith({
        event: 'dot_remote_event_refused',
        code: 'request_status',
        dotRequestId: requestId(1)
      })
    })
  })

  it('logs a reader failure by code and keeps the other requests going', () => {
    getDotRemoteRequestStore(owner).track({
      dotRequestId: requestId(2),
      submitItemId: '10000000-0000-4000-8000-000000000002',
      generation: 1,
      timestamp: '2026-10-05T12:00:01.000Z'
    })
    const log = vi.fn()
    const sync = createDotRemoteEventSync({
      owner,
      source: {
        snapshot: (dotRequestId: string) => {
          if (dotRequestId === requestId(1)) {
            throw new Error('Fixture: C:\\private\\path failed')
          }
          return current
        }
      },
      now: clock.now,
      newEventId: () => `60000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
      log
    })
    expect(sync.run().recorded).toBe(1)
    expect(JSON.stringify(log.mock.calls)).not.toContain('private')
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'dot_remote_snapshot_failed' })
    )
  })
})

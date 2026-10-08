import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOT_DECISION_SUMMARY_MAX_CHARS } from '../../../shared/dot-ingress/dot-ingress-limits'
import {
  PERMISSION_DECISION_VIEW_STATUSES,
  WorkbenchPermissionListResultSchema
} from '../../../shared/rpc-contract/permission-relay-params'
import {
  PERMISSION_DECISION_STATUSES,
  PERMISSION_SUMMARY_MAX_CHARS
} from '../orchestration/db/autopilot-run-schema-definition'
import {
  FIXTURE_EVIDENCE,
  FIXTURE_HANDLE,
  FIXTURE_START_MS,
  createRelayHarness,
  relayRequest,
  type RelayHarness
} from './permission-relay.test-fixture'

function relayedId(harness: RelayHarness, overrides = {}): string {
  const result = harness.service.request(FIXTURE_EVIDENCE, relayRequest(overrides))
  if (result.outcome !== 'relayed') {
    throw new Error('expected a relayed prompt')
  }
  return result.decisionId
}

describe('permission relay service: terminal answers, expiry and views', () => {
  let harness: RelayHarness

  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_START_MS })
    harness = createRelayHarness()
  })
  afterEach(() => {
    harness.service.dispose()
    harness.owner.close()
    vi.useRealTimers()
  })

  it('closes a prompt as answered in the terminal when its dialog is answered there', async () => {
    const id = relayedId(harness, { waitBudgetMs: 5_000 })
    harness.setStatus(FIXTURE_HANDLE, 'permission')
    await harness.service.tick()
    await vi.advanceTimersByTimeAsync(60_000)
    await harness.service.tick()
    expect(harness.store.get(id)?.status).toBe('pending')
    harness.setStatus(FIXTURE_HANDLE, 'working')
    await harness.service.tick()
    expect(harness.store.get(id)).toMatchObject({
      status: 'answered_in_terminal',
      decidedBy: 'terminal'
    })
  })

  it('lets a waiting hook print nothing when the user answers in the terminal first', async () => {
    const id = relayedId(harness)
    const waiting = harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
    harness.setStatus(FIXTURE_HANDLE, 'permission')
    await harness.service.tick()
    harness.setStatus(FIXTURE_HANDLE, 'idle')
    await harness.service.tick()
    await expect(waiting).resolves.toEqual({ state: 'no_decision' })
  })

  it('does not expire a prompt whose dialog is still open in the terminal', async () => {
    const id = relayedId(harness, { waitBudgetMs: 5_000 })
    harness.setStatus(FIXTURE_HANDLE, 'permission')
    await harness.service.tick()
    await vi.advanceTimersByTimeAsync(600_000)
    await harness.service.tick()
    expect(harness.store.get(id)?.status).toBe('pending')
  })

  it('keeps an overdue prompt open for its terminal dialog when the same session raises another', async () => {
    const older = relayedId(harness, { waitBudgetMs: 5_000 })
    harness.setStatus(FIXTURE_HANDLE, 'permission')
    await harness.service.tick()
    await vi.advanceTimersByTimeAsync(60_000)
    relayedId(harness)
    await harness.service.tick()
    expect(harness.store.get(older)?.status).toBe('pending')
    harness.setStatus(FIXTURE_HANDLE, 'working')
    await harness.service.tick()
    expect(harness.store.get(older)?.status).toBe('answered_in_terminal')
  })

  it('expires an overdue prompt it cannot observe', async () => {
    const id = relayedId(harness, { waitBudgetMs: 5_000 })
    harness.setStatus(FIXTURE_HANDLE, 'gone')
    await vi.advanceTimersByTimeAsync(10_000)
    for (let tick = 0; tick < 4; tick += 1) {
      await harness.service.tick()
    }
    expect(harness.store.get(id)?.status).toBe('expired')
  })

  it('does not touch a prompt before its deadline when it never saw the dialog', async () => {
    const id = relayedId(harness)
    await harness.service.tick()
    await harness.service.tick()
    expect(harness.store.get(id)?.status).toBe('pending')
  })

  it('lists primary and critical prompts for dot to review or ask the user', () => {
    const plain = relayedId(harness)
    const web = relayedId(harness, { toolName: 'WebFetch', toolInput: {} })
    const secret = relayedId(harness, {
      toolName: 'Read',
      toolInput: { file_path: '/fixture/repo/.env' }
    })
    const forDot = harness.service.listForDot('run_fixture01', { limit: 50 })
    expect(forDot.map((record) => record.decisionId)).toEqual([plain, web, secret])
  })

  it('lists every prompt for the desktop, marking which are desktop only and answerable', async () => {
    const plain = relayedId(harness)
    const desktopOnly = relayedId(harness, { toolName: 'mcp__github__create_issue', toolInput: {} })
    const listed = harness.service.listForDesktop({})
    expect(
      listed.decisions.map((view) => [view.decisionId, view.desktopOnly, view.answerable])
    ).toEqual([
      [plain, false, true],
      [desktopOnly, true, true]
    ])
    expect(listed.decisions[1]?.summary).toBe('Desktop only. mcp__github__create_issue')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(
      harness.service
        .listForDesktop({ runId: 'run_fixture01' })
        .decisions.every((view) => !view.answerable)
    ).toBe(true)
    expect(harness.service.listForDesktop({ runId: 'run_unknown' }).decisions).toEqual([])
  })

  it('keeps the shared contract aligned with the store and the dot view', () => {
    expect([...PERMISSION_DECISION_VIEW_STATUSES].sort()).toEqual(
      [...PERMISSION_DECISION_STATUSES].sort()
    )
    expect(DOT_DECISION_SUMMARY_MAX_CHARS).toBe(PERMISSION_SUMMARY_MAX_CHARS)
    relayedId(harness)
    relayedId(harness, { toolName: 'Write', toolInput: { file_path: '/fixture/repo/.mcp.json' } })
    const listed = harness.service.listForDesktop({ statuses: ['pending'], limit: 10 })
    expect(WorkbenchPermissionListResultSchema.parse(listed)).toEqual(listed)
    expect(listed.decisions).toHaveLength(2)
  })

  it('answers from the desktop with a view of the result', async () => {
    const id = relayedId(harness)
    const waiting = harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
    const answered = harness.service.answerFromDesktop({ decisionId: id, decision: 'deny' })
    expect(answered).toMatchObject({
      outcome: 'decided',
      decision: { decisionId: id, status: 'denied', decidedBy: 'desktop', answerable: false }
    })
    await expect(waiting).resolves.toMatchObject({ state: 'decided' })
    expect(
      harness.service.answerFromDesktop({ decisionId: 'decision_missing', decision: 'deny' })
    ).toEqual({
      outcome: 'not_found',
      decision: null
    })
  })

  it('watches prompts left pending by an earlier app session once started', async () => {
    const id = relayedId(harness, { waitBudgetMs: 5_000 })
    const restarted = harness.newService()
    restarted.start()
    harness.setStatus(FIXTURE_HANDLE, 'permission')
    await restarted.tick()
    harness.setStatus(FIXTURE_HANDLE, 'working')
    await restarted.tick()
    restarted.dispose()
    expect(harness.store.get(id)?.status).toBe('answered_in_terminal')
  })
})

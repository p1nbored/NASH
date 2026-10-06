import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { getPermissionDecisionStore } from '../orchestration/db/permission-decision-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { answerDotDecision, listDotDecisions } from './dot-ingress-decisions-service'
import { submitDotRequest } from './dot-ingress-intake'
import {
  createFixtureRelay,
  seedForeignRun,
  seedLivePrimary,
  type FixtureRelay
} from './dot-ingress-relay.test-fixture'
import { findDotRequestRun } from './dot-ingress-run-link'
import {
  FIXTURE_NOW_MS,
  createDotHarness,
  fixtureUuid,
  type DotHarness
} from './dot-ingress-service.test-fixture'

const BASH = { toolName: 'Bash', toolInput: { command: 'git status' } }
const READ = { toolName: 'Read', toolInput: { file_path: '/fixture/repo/docs/plan.md' } }
const DESKTOP_ONLY = { toolName: 'WebFetch', toolInput: {} }

function refusalOf(operation: () => unknown): { code: string; data: unknown } | null {
  try {
    operation()
    return null
  } catch (error) {
    if (error instanceof OrchestrationError) {
      return { code: error.code, data: error.data }
    }
    throw error
  }
}

describe('dot decisions: permission prompts of the runs dot started (D-017, RG7)', () => {
  let harness: DotHarness
  let fixture: FixtureRelay

  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_NOW_MS })
    harness = createDotHarness({ maxAccess: 'workspace_write' })
    fixture = createFixtureRelay(harness.owner)
    harness.setRelay(fixture.relay)
  })
  afterEach(() => {
    fixture.relay.dispose()
    harness.close()
    vi.useRealTimers()
  })

  async function dotRun(n: number, access: 'read_only' | 'workspace_write' = 'read_only') {
    const { record } = await submitDotRequest(
      harness.deps,
      harness.submitRequest({ idempotencyKey: fixtureUuid(n), requestedAccess: access })
    )
    const run = findDotRequestRun(harness.owner, record)
    if (!run) {
      throw new Error('expected a launched run')
    }
    return { record, evidence: seedLivePrimary(harness.owner, run.runId, n) }
  }

  it('lists the pending prompts of every dot run, each tied to its dot request', async () => {
    const first = await dotRun(1)
    const second = await dotRun(2)
    seedForeignRun(harness.owner, 'run-foreign')
    const foreign = seedLivePrimary(harness.owner, 'run-foreign', 9)
    const firstPrompt = fixture.raise(first.evidence, BASH)
    vi.advanceTimersByTime(1_000)
    const secondPrompt = fixture.raise(second.evidence, READ)
    fixture.raise(second.evidence, DESKTOP_ONLY)
    fixture.raise(foreign, BASH)

    const listed = listDotDecisions(harness.deps, { limit: 50 })

    expect(listed.map((entry) => [entry.record.decisionId, entry.dotRequestId])).toEqual([
      [firstPrompt, first.record.dotRequestId],
      [secondPrompt, second.record.dotRequestId]
    ])
  })

  it('lists one request only when asked, and nothing for a request without a run', async () => {
    const first = await dotRun(1)
    const second = await dotRun(2)
    fixture.raise(first.evidence, BASH)
    const secondPrompt = fixture.raise(second.evidence, BASH)
    harness.door.launch = 'received'
    const unlaunched = (
      await submitDotRequest(
        harness.deps,
        harness.submitRequest({ idempotencyKey: fixtureUuid(3) })
      )
    ).record

    expect(
      listDotDecisions(harness.deps, { dotRequestId: second.record.dotRequestId, limit: 50 }).map(
        (entry) => entry.record.decisionId
      )
    ).toEqual([secondPrompt])
    expect(
      listDotDecisions(harness.deps, { dotRequestId: unlaunched.dotRequestId, limit: 50 })
    ).toEqual([])
    expect(
      refusalOf(() => listDotDecisions(harness.deps, { dotRequestId: fixtureUuid(99), limit: 5 }))
        ?.code
    ).toBe('dot_request_not_found')
  })

  it('lists nothing while no relay is installed', async () => {
    const first = await dotRun(1)
    fixture.raise(first.evidence, BASH)
    harness.setRelay(null)
    expect(listDotDecisions(harness.deps, { limit: 50 })).toEqual([])
  })

  it('lets dot deny a command on a read-only run, through the first-answer-wins path', async () => {
    const run = await dotRun(1)
    const id = fixture.raise(run.evidence, BASH)
    const answered = answerDotDecision(harness.deps, { decisionId: id, decision: 'deny' })
    expect(answered).toMatchObject({
      outcome: 'decided',
      dotRequestId: run.record.dotRequestId,
      record: { status: 'denied', decidedBy: 'dot' }
    })
    expect(answerDotDecision(harness.deps, { decisionId: id, decision: 'allow' })).toMatchObject({
      outcome: 'already_decided',
      record: { status: 'denied' }
    })
  })

  it('refuses dot allowing a command on a read-only run as deny-only, keeps the prompt pending', async () => {
    const run = await dotRun(1)
    const id = fixture.raise(run.evidence, BASH)
    expect(
      refusalOf(() => answerDotDecision(harness.deps, { decisionId: id, decision: 'allow' }))
    ).toEqual({
      code: 'dot_decision_deny_only',
      data: { reason: 'run_read_only' }
    })
    expect(getPermissionDecisionStore(harness.owner).get(id)?.status).toBe('pending')
  })

  it('lets dot allow a read on a read-only run and a command on a run that may write', async () => {
    const readOnly = await dotRun(1)
    const writable = await dotRun(2, 'workspace_write')
    const read = fixture.raise(readOnly.evidence, READ)
    const command = fixture.raise(writable.evidence, BASH)
    for (const decisionId of [read, command]) {
      expect(answerDotDecision(harness.deps, { decisionId, decision: 'allow' })).toMatchObject({
        outcome: 'decided',
        record: { status: 'allowed', decidedBy: 'dot' }
      })
    }
  })

  it('does not reveal or answer a prompt of a run dot did not start', async () => {
    seedForeignRun(harness.owner, 'run-foreign')
    const foreign = fixture.raise(seedLivePrimary(harness.owner, 'run-foreign', 9), BASH)
    expect(
      refusalOf(() => answerDotDecision(harness.deps, { decisionId: foreign, decision: 'deny' }))
        ?.code
    ).toBe('dot_decision_not_found')
    expect(getPermissionDecisionStore(harness.owner).get(foreign)?.status).toBe('pending')
  })

  it('keeps a desktop-only prompt for the desktop, and reports an unknown id as not found', async () => {
    const run = await dotRun(1)
    const id = fixture.raise(run.evidence, DESKTOP_ONLY)
    expect(
      refusalOf(() => answerDotDecision(harness.deps, { decisionId: id, decision: 'deny' }))?.code
    ).toBe('dot_decision_desktop_only')
    expect(
      refusalOf(() =>
        answerDotDecision(harness.deps, { decisionId: fixtureUuid(98), decision: 'deny' })
      )?.code
    ).toBe('dot_decision_not_found')
  })

  it('reports a prompt the app no longer waits on as closed, with nothing written', async () => {
    const run = await dotRun(1)
    const id = fixture.raise(run.evidence, BASH)
    vi.advanceTimersByTime(25 * 60_000)
    expect(answerDotDecision(harness.deps, { decisionId: id, decision: 'deny' })).toMatchObject({
      outcome: 'closed',
      record: { status: 'pending' }
    })
  })

  it('keeps every prompt for the desktop while the relay is not running', async () => {
    const run = await dotRun(1)
    const id = fixture.raise(run.evidence, BASH)
    harness.setRelay(null)
    expect(
      refusalOf(() => answerDotDecision(harness.deps, { decisionId: id, decision: 'deny' }))
    ).toEqual({
      code: 'dot_decision_desktop_only',
      data: { reason: 'relay_unavailable' }
    })
  })

  it('refuses listing and answering while the interface is off', async () => {
    const run = await dotRun(1)
    const id = fixture.raise(run.evidence, BASH)
    getDotIngressSettingsStore(harness.owner).setEnabled({
      enabled: false,
      timestamp: new Date(Date.now()).toISOString()
    })
    expect(refusalOf(() => listDotDecisions(harness.deps, { limit: 5 }))?.code).toBe(
      'dot_ingress_disabled'
    )
    expect(
      refusalOf(() => answerDotDecision(harness.deps, { decisionId: id, decision: 'deny' }))?.code
    ).toBe('dot_ingress_disabled')
  })
})

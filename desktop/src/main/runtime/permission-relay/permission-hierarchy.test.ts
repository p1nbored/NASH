import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRelayHarness,
  FIXTURE_EVIDENCE,
  FIXTURE_START_MS,
  relayRequest,
  type RelayHarness,
  primaryAuthority
} from './permission-relay.test-fixture'

describe('permission review hierarchy', () => {
  let h: RelayHarness
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_START_MS })
    h = createRelayHarness()
    h.owner.db
      .prepare("UPDATE workflow_runs SET requested_access = 'workspace_write', status = 'active'")
      .run()
  })
  afterEach(() => {
    h.service.dispose()
    h.owner.close()
    vi.useRealTimers()
  })
  function request(agentId: string | null, command = 'git status') {
    if (agentId) {
      const task = h.owner.createTask({ runId: 'run_fixture01', spec: 'Fixture task' })
      const started = h.owner.createStartingWorkerDispatch({
        taskId: task.id,
        startOptions: {},
        creator: { kind: 'system' },
        maxDepth: 3
      })
      h.owner.prepareStartingWorkerAuthority({
        dispatchId: started.dispatch.id,
        handle: agentId,
        paneKey: `${agentId}:1`,
        processIncarnation: `process-${agentId}`,
        launchTokenHash: 'e'.repeat(64),
        worktreeId: 'fixture-repo::/fixture/repo',
        effects: [],
        setupState: 'not_applicable'
      })
      h.setAuthority(
        primaryAuthority({
          terminalHandle: agentId,
          paneKey: `${agentId}:1`,
          processIncarnation: `process-${agentId}`,
          launchTokenHash: 'e'.repeat(64)
        })
      )
    }
    const result = h.service.request(
      FIXTURE_EVIDENCE,
      relayRequest({ agentId, toolInput: { command } })
    )
    h.setAuthority(primaryAuthority())
    if (result.outcome !== 'relayed') {
      throw new Error('Expected relay')
    }
    return result.decisionId
  }

  it('lets the primary answer a child request, and returns that answer to the hook', async () => {
    const decisionId = request('child-1')
    expect(h.service.listForPrimary(FIXTURE_EVIDENCE).decisions.map((d) => d.decisionId)).toEqual([
      decisionId
    ])
    expect(h.service.listForDot('run_fixture01', { limit: 20 })).toEqual([])
    expect(
      h.service.answerFromPrimary(FIXTURE_EVIDENCE, { decisionId, decision: 'allow' }).outcome
    ).toBe('decided')
    expect(h.store.get(decisionId)?.decidedBy).toBe('primary')
    h.setAuthority(
      primaryAuthority({
        terminalHandle: 'child-1',
        paneKey: 'child-1:1',
        processIncarnation: 'process-child-1',
        launchTokenHash: 'e'.repeat(64)
      })
    )
    await expect(
      h.service.wait(FIXTURE_EVIDENCE, { decisionId, waitMs: 1 })
    ).resolves.toMatchObject({
      state: 'decided',
      hookOutput: { hookSpecificOutput: { decision: { behavior: 'allow' } } }
    })
  })

  it('refuses primary self approval and dot approval of ordinary child requests', () => {
    const own = request(null)
    const child = request('child-1')
    expect(() =>
      h.service.answerFromPrimary(FIXTURE_EVIDENCE, { decisionId: own, decision: 'allow' })
    ).toThrow()
    expect(() => h.service.answerFromDot({ decisionId: child, decision: 'allow' })).toThrow()
    expect(h.store.get(own)?.status).toBe('pending')
    expect(h.store.get(child)?.status).toBe('pending')
  })

  it('shows critical requests to dot for user escalation but refuses agent approval', () => {
    const decisionId = request('child-1', 'rm -rf /fixture/repo')
    expect(h.service.listForDot('run_fixture01', { limit: 20 }).map((d) => d.decisionId)).toEqual([
      decisionId
    ])
    expect(() =>
      h.service.answerFromPrimary(FIXTURE_EVIDENCE, { decisionId, decision: 'allow' })
    ).toThrow()
    expect(() => h.service.answerFromDot({ decisionId, decision: 'allow' })).toThrow()
    expect(h.service.answerFromDesktop({ decisionId, decision: 'allow' }).outcome).toBe('decided')
  })

  it('does not let a restarted primary answer the old owner requests', () => {
    const decisionId = request('child-1')
    h.setAuthority(null)
    expect(() =>
      h.service.answerFromPrimary(FIXTURE_EVIDENCE, { decisionId, decision: 'allow' })
    ).toThrow()
    expect(h.store.get(decisionId)?.status).toBe('pending')
  })
  it('does not trust a primary-supplied child id', () => {
    const result = h.service.request(FIXTURE_EVIDENCE, relayRequest({ agentId: 'forged-child' }))
    if (result.outcome !== 'relayed') {
      throw new Error('Expected relay')
    }
    expect(h.store.get(result.decisionId)?.agentId).toBeNull()
    expect(() =>
      h.service.answerFromPrimary(FIXTURE_EVIDENCE, {
        decisionId: result.decisionId,
        decision: 'allow'
      })
    ).toThrow()
  })
  it('refuses a primary consuming a child decision', async () => {
    const decisionId = request('child-1')
    await expect(h.service.wait(FIXTURE_EVIDENCE, { decisionId, waitMs: 1 })).rejects.toThrow()
  })
  it('keeps a settled answer consumable across maintenance ticks', async () => {
    const decisionId = request(null)
    expect(h.service.answerFromDot({ decisionId, decision: 'allow' }).outcome).toBe('decided')
    await h.service.tick()
    await expect(
      h.service.wait(FIXTURE_EVIDENCE, { decisionId, waitMs: 1 })
    ).resolves.toMatchObject({ state: 'decided' })
  })
  it('closes review when the dispatch is rebound to a new process', () => {
    const decisionId = request('child-1')
    h.owner.db
      .prepare('UPDATE dispatch_contexts SET process_incarnation = ? WHERE id = ?')
      .run('new-process', h.store.get(decisionId)!.agentId)
    expect(
      h.service.answerFromPrimary(FIXTURE_EVIDENCE, { decisionId, decision: 'allow' }).outcome
    ).toBe('closed')
  })
  it('refuses approval after the child stops', () => {
    const decisionId = request('child-1')
    const child = h.store.get(decisionId)!.agentId
    h.owner.db
      .prepare("UPDATE worker_dispatches SET state = 'stopped' WHERE dispatch_id = ?")
      .run(child)
    expect(
      h.service.answerFromPrimary(FIXTURE_EVIDENCE, { decisionId, decision: 'allow' }).outcome
    ).toBe('closed')
    expect(h.store.get(decisionId)?.status).toBe('pending')
  })
})

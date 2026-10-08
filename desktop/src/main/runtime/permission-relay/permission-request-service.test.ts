import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { PERMISSION_RELAY_WAIT_MS } from '../../../shared/rpc-contract/permission-relay-params'
import { PERMISSION_RELAY_ERROR_CODES } from './permission-relay-caller'
import {
  FIXTURE_EVIDENCE,
  FIXTURE_REQUEST_HASH,
  FIXTURE_START_MS,
  createRelayHarness,
  primaryAuthority,
  relayRequest,
  type RelayHarness
} from './permission-relay.test-fixture'

function codeOf(operation: () => unknown): string | null {
  try {
    operation()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : `unexpected: ${String(error)}`
  }
}

function relayedId(harness: RelayHarness, overrides = {}): string {
  const result = harness.service.request(FIXTURE_EVIDENCE, relayRequest(overrides))
  if (result.outcome !== 'relayed') {
    throw new Error('expected a relayed prompt')
  }
  return result.decisionId
}

describe('permission relay service: request, wait and answer', () => {
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

  describe('caller check', () => {
    it('refuses a caller without attested evidence and stores nothing', () => {
      expect(codeOf(() => harness.service.request(undefined, relayRequest()))).toBe(
        PERMISSION_RELAY_ERROR_CODES.callerRefused
      )
      expect(
        codeOf(() =>
          harness.service.request({ ...FIXTURE_EVIDENCE, launchToken: 'other' }, relayRequest())
        )
      ).toBe(PERMISSION_RELAY_ERROR_CODES.callerRefused)
      expect(harness.store.listPending('run_fixture01', 10)).toEqual([])
    })

    it('refuses an attested pane that is not the primary of an app run', () => {
      harness.setAuthority(primaryAuthority({ paneKey: 'pane_other:1' }))
      expect(codeOf(() => harness.service.request(FIXTURE_EVIDENCE, relayRequest()))).toBe(
        PERMISSION_RELAY_ERROR_CODES.callerRefused
      )
    })

    it('refuses the primary pane when its process is not the one the app launched', () => {
      harness.setAuthority(primaryAuthority({ processIncarnation: 'incarnation_other' }))
      expect(codeOf(() => harness.service.request(FIXTURE_EVIDENCE, relayRequest()))).toBe(
        PERMISSION_RELAY_ERROR_CODES.callerRefused
      )
    })

    it('never creates the app tables for a database that has no app run', () => {
      const bare = createRelayHarness({ seed: false })
      expect(codeOf(() => bare.service.request(FIXTURE_EVIDENCE, relayRequest()))).toBe(
        PERMISSION_RELAY_ERROR_CODES.callerRefused
      )
      const tables = bare.owner.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('workflow_runs', 'permission_decisions')"
        )
        .all()
      expect(tables).toEqual([])
      bare.owner.close()
    })
  })

  describe('request', () => {
    it('records a pending prompt with a redacted one-line summary and the relay deadline', () => {
      const result = harness.service.request(
        FIXTURE_EVIDENCE,
        relayRequest({
          agentId: 'agent_fixture01',
          toolInput: { command: 'npm test\n--token abcdefghijklmnop' }
        })
      )
      expect(result.outcome).toBe('relayed')
      const record = result.outcome === 'relayed' ? harness.store.get(result.decisionId) : null
      expect(record).toMatchObject({
        runId: 'run_fixture01',
        ownerId: harness.ownerId,
        agentId: null,
        toolName: 'Bash',
        summary: 'Bash: npm test --token [redacted]',
        requestSha256: FIXTURE_REQUEST_HASH,
        status: 'pending',
        createdAt: new Date(FIXTURE_START_MS).toISOString(),
        deadlineAt: new Date(FIXTURE_START_MS + PERMISSION_RELAY_WAIT_MS).toISOString()
      })
    })

    it('ends the relay wait inside the budget the hook has left', () => {
      const id = relayedId(harness, { waitBudgetMs: 60_000 })
      expect(harness.store.get(id)?.deadlineAt).toBe(
        new Date(FIXTURE_START_MS + 60_000).toISOString()
      )
    })

    it('leaves question and plan dialogs to the terminal and records nothing', () => {
      expect(
        harness.service.request(
          FIXTURE_EVIDENCE,
          relayRequest({ toolName: 'AskUserQuestion', toolInput: {} })
        )
      ).toEqual({
        outcome: 'not_relayed',
        reason: 'terminal_only_tool'
      })
      expect(harness.store.listPending('run_fixture01', 10)).toEqual([])
    })

    it('records a write by its file name only', () => {
      const id = relayedId(harness, {
        toolName: 'Write',
        toolInput: { file_path: '/fixture/repo/src/a.ts' }
      })
      expect(harness.store.get(id)?.summary).toBe('Write: src/a.ts')
    })
  })

  describe('wait and answer', () => {
    it('hands the first answer to the waiting hook as the documented allow decision', async () => {
      // RG7: the seeded run is read-only, so dot's allow is shown on a read prompt.
      const id = relayedId(harness, {
        toolName: 'Read',
        toolInput: { file_path: '/fixture/repo/docs/plan.md' }
      })
      const waiting = harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
      await vi.advanceTimersByTimeAsync(1_500)
      expect(
        harness.service.answer({ decisionId: id, decision: 'allow', decidedBy: 'dot' }).outcome
      ).toBe('decided')
      await expect(waiting).resolves.toEqual({
        state: 'decided',
        hookOutput: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'allow' }
          }
        }
      })
    })

    it('lets the first answer win: a later one is reported as already decided', async () => {
      const id = relayedId(harness)
      const waiting = harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
      expect(
        harness.service.answer({ decisionId: id, decision: 'deny', decidedBy: 'desktop' }).outcome
      ).toBe('decided')
      const late = harness.service.answer({ decisionId: id, decision: 'allow', decidedBy: 'dot' })
      expect(late).toMatchObject({
        outcome: 'already_decided',
        record: { status: 'denied', decidedBy: 'desktop' }
      })
      await expect(waiting).resolves.toMatchObject({
        state: 'decided',
        hookOutput: { hookSpecificOutput: { decision: { behavior: 'deny' } } }
      })
    })

    it('returns pending at the end of a slice and no decision once the relay wait is over', async () => {
      const id = relayedId(harness, { waitBudgetMs: 30_000 })
      const first = harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(first).resolves.toEqual({ state: 'pending' })
      const second = harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(second).resolves.toEqual({ state: 'no_decision' })
      expect(harness.store.get(id)?.status).toBe('pending')
    })

    it('refuses dot on a desktop-only prompt with no effect, and lets the desktop answer it', async () => {
      const id = relayedId(harness, {
        toolName: 'Edit',
        toolInput: { file_path: '/fixture/repo/.claude/settings.json' }
      })
      const waiting = harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
      expect(
        codeOf(() =>
          harness.service.answer({ decisionId: id, decision: 'allow', decidedBy: 'dot' })
        )
      ).toBe(PERMISSION_RELAY_ERROR_CODES.desktopOnly)
      expect(harness.store.get(id)?.status).toBe('pending')
      expect(
        harness.service.answer({ decisionId: id, decision: 'allow', decidedBy: 'desktop' }).outcome
      ).toBe('decided')
      await expect(waiting).resolves.toMatchObject({ state: 'decided' })
    })

    it('reports a prompt as closed once the relay wait is over, and keeps it open for the terminal', async () => {
      const id = relayedId(harness, { waitBudgetMs: 5_000 })
      await vi.advanceTimersByTimeAsync(5_000)
      expect(
        harness.service.answer({ decisionId: id, decision: 'allow', decidedBy: 'dot' })
      ).toMatchObject({
        outcome: 'closed',
        record: { status: 'pending' }
      })
      expect(harness.store.get(id)?.status).toBe('pending')
    })

    it('reports a prompt as closed when no hook is waiting for it any more', async () => {
      const id = relayedId(harness)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(
        harness.service.answer({ decisionId: id, decision: 'allow', decidedBy: 'desktop' }).outcome
      ).toBe('closed')
      expect(harness.store.get(id)?.status).toBe('pending')
    })

    it('does not let another caller wait on a prompt', async () => {
      const id = relayedId(harness)
      harness.setAuthority(primaryAuthority({ paneKey: 'pane_other:1' }))
      await expect(
        harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 1_000 })
      ).rejects.toMatchObject({
        code: PERMISSION_RELAY_ERROR_CODES.callerRefused
      })
    })

    it('reports an unknown prompt as not found', async () => {
      expect(
        harness.service.answer({
          decisionId: 'decision_missing',
          decision: 'allow',
          decidedBy: 'dot'
        })
      ).toEqual({
        outcome: 'not_found'
      })
      await expect(
        harness.service.wait(FIXTURE_EVIDENCE, { decisionId: 'decision_missing', waitMs: 1_000 })
      ).rejects.toMatchObject({ code: PERMISSION_RELAY_ERROR_CODES.notFound })
    })
  })
})

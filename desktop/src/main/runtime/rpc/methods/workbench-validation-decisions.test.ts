import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkbenchValidationDecideParams,
  WorkbenchValidationListDecisionsParams
} from '../../../../shared/rpc-contract/workbench-validation-decision-params'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../../orchestration/db/app-attempt.test-fixture'
import {
  FIXTURE_OWN_WORKTREE,
  inconclusiveAttempt
} from '../../task-validation/validation-decision.test-fixture'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { ALL_RPC_METHODS } from './index'
import {
  WORKBENCH_VALIDATION_DECIDE_METHOD,
  WORKBENCH_VALIDATION_LIST_DECISIONS_METHOD,
  WORKBENCH_VALIDATION_METHODS
} from './workbench-validation'

// FIXTURE_ONLY: synthetic pane evidence of the kind the primary's own `nash` CLI attaches.
const PRIMARY_PANE_EVIDENCE = {
  terminalHandle: 'term_fixture_primary',
  paneKey: 'tab-fixture:pane-1',
  launchToken: 'fixture-launch-token'
}
const LIST = 'workbench.validation.listDecisions'
const DECIDE = 'workbench.validation.decide'

describe('workbench validation decision methods', () => {
  let harness: AppRunHarness
  let runtime: {
    getRuntimeId: ReturnType<typeof vi.fn>
    getOrchestrationDb: ReturnType<typeof vi.fn>
    notifyMessageArrived: ReturnType<typeof vi.fn>
    requireWorkbenchWorkspace: ReturnType<typeof vi.fn>
  }
  let dispatcher: RpcDispatcher

  beforeEach(() => {
    harness = createAppRunHarness()
    runtime = {
      getRuntimeId: vi.fn(() => 'fixture-runtime'),
      getOrchestrationDb: vi.fn(() => harness.owner),
      notifyMessageArrived: vi.fn(),
      // Why a refusal: the worktree is not in the catalog, so no git runs and the notice states no fact.
      requireWorkbenchWorkspace: vi.fn(() => {
        throw new Error('fixture: workspace not admitted')
      })
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the decision methods read only these runtime members.
    dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS })
  })
  afterEach(() => harness.owner.close())

  function request(method: string, params: unknown, extra: Record<string, unknown> = {}) {
    const envelope: RpcRequest = {
      id: 'fixture-request',
      authToken: 'fixture-local-token',
      method,
      params,
      ...extra
    }
    return envelope
  }
  const desktop = (method: string, params: unknown) =>
    dispatcher.dispatch(request(method, params), { workbenchCaller: issueWorkbenchDesktopCaller() })

  it('registers both methods with the shared params next to Check now', () => {
    expect(WORKBENCH_VALIDATION_LIST_DECISIONS_METHOD.name).toBe(LIST)
    expect(WORKBENCH_VALIDATION_LIST_DECISIONS_METHOD.params).toBe(
      WorkbenchValidationListDecisionsParams
    )
    expect(WORKBENCH_VALIDATION_DECIDE_METHOD.name).toBe(DECIDE)
    expect(WORKBENCH_VALIDATION_DECIDE_METHOD.params).toBe(WorkbenchValidationDecideParams)
    expect(WORKBENCH_VALIDATION_METHODS.map((method) => method.name)).toEqual([
      'workbench.validation.checkPending',
      LIST,
      DECIDE
    ])
  })

  it('lists the results waiting for a decision for the desktop', async () => {
    const write = inconclusiveAttempt(harness, {
      executableEvidence: { executable: 'codex', attemptWorkspace: FIXTURE_OWN_WORKTREE }
    })
    expect(await desktop(LIST, {})).toMatchObject({
      ok: true,
      result: {
        decisions: [
          {
            validationId: write.validationId,
            placement: 'own_worktree',
            worktree: { branch: 'nash-task-1' },
            processMayRun: false
          }
        ],
        hasMore: false
      }
    })
    expect(runtime.getOrchestrationDb).toHaveBeenCalledWith({ passive: true })
  })

  it('waives as the desktop user, files the merge notice and announces it to the run', async () => {
    const write = inconclusiveAttempt(harness, {
      executableEvidence: { executable: 'codex', attemptWorkspace: FIXTURE_OWN_WORKTREE }
    })
    expect(
      await desktop(DECIDE, { validationId: write.validationId, decision: 'waive' })
    ).toMatchObject({
      ok: true,
      result: { decision: 'waived', taskStatus: 'completed', noticeFiled: true }
    })
    expect(harness.owner.getTask(write.taskId)?.status).toBe('completed')
    expect(runtime.notifyMessageArrived).toHaveBeenCalledExactlyOnceWith(
      `run:${harness.runId}`,
      'status'
    )
    // The worktree is re-admitted through the catalog before any git read; here it is refused.
    expect(runtime.requireWorkbenchWorkspace).toHaveBeenCalledWith(FIXTURE_OWN_WORKTREE.worktreeId)
    const notice = harness.owner.db
      .prepare('SELECT body FROM messages WHERE to_handle = ?')
      .all(`run:${harness.runId}`)
    expect(JSON.stringify(notice)).toMatch(/\bcheck\b/i)
    expect(JSON.stringify(notice)).not.toMatch(/changes are (committed|uncommitted)/)
  })

  it('rejects as the desktop user and then answers a repeated decision with the store conflict', async () => {
    const attempt = inconclusiveAttempt(harness)
    expect(
      await desktop(DECIDE, { validationId: attempt.validationId, decision: 'reject' })
    ).toMatchObject({ ok: true, result: { decision: 'rejected', taskStatus: 'failed' } })
    for (const decision of ['reject', 'waive']) {
      expect(await desktop(DECIDE, { validationId: attempt.validationId, decision })).toMatchObject(
        {
          ok: false,
          error: {
            code: 'autopilot_validation_conflict',
            message: 'The validation is already settled or was waived.'
          }
        }
      )
    }
    expect(harness.owner.getTask(attempt.taskId)?.status).toBe('failed')
  })

  it('refuses params that try to name the decider or decide something else', async () => {
    const attempt = inconclusiveAttempt(harness)
    for (const params of [
      { validationId: attempt.validationId, decision: 'waive', by: 'dot' },
      { validationId: attempt.validationId, decision: 'pass' },
      { validationId: attempt.validationId }
    ]) {
      expect(await desktop(DECIDE, params)).toMatchObject({ ok: false })
    }
    expect(await desktop(LIST, { limit: 0 })).toMatchObject({ ok: false })
    expect(harness.owner.getTask(attempt.taskId)?.status).toBe('blocked')
  })

  describe('the primary session can never resolve its own inconclusive result', () => {
    const callers: readonly (readonly [
      string,
      Record<string, unknown>,
      Record<string, unknown>
    ])[] = [
      [
        "the primary's nash CLI with its attested pane",
        { orchestrationCompatibilityEvidence: PRIMARY_PANE_EVIDENCE },
        { clientId: 'orca-cli', clientKind: 'runtime', authenticatedCallerFingerprint: 'cli' }
      ],
      ['the CLI with only its local token', {}, { clientId: 'orca-cli', clientKind: 'runtime' }],
      [
        'a hand-built desktop caller',
        {},
        { workbenchCaller: { principalId: 'local-desktop-ui', source: 'desktop_ui' } }
      ],
      [
        'a caller smuggled into the envelope',
        { workbenchCaller: issueWorkbenchDesktopCaller() },
        {}
      ]
    ]

    it.each(callers)('refuses %s before any read or write', async (_who, extra, options) => {
      const attempt = inconclusiveAttempt(harness)
      for (const [method, params] of [
        [LIST, {}],
        [DECIDE, { validationId: attempt.validationId, decision: 'waive' }]
      ] as const) {
        expect(await dispatcher.dispatch(request(method, params, extra), options)).toMatchObject({
          ok: false,
          error: { code: 'workbench_forbidden' }
        })
      }
      expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
      expect(runtime.notifyMessageArrived).not.toHaveBeenCalled()
      expect(harness.owner.getTask(attempt.taskId)?.status).toBe('blocked')
    })

    it('exposes no other RPC method that reaches the decision service or port', () => {
      const root = join(process.cwd(), 'src/main/runtime/rpc')
      const reaching = readdirSync(root, { recursive: true, encoding: 'utf8' })
        .map((path) => path.split(sep).join('/'))
        .filter((path) => path.endsWith('.ts') && !/\.test\.ts$|test-fixture/.test(path))
        .filter((path) =>
          /validation-decision-service|createValidationDecisionPort|ValidationDecisionPort/.test(
            readFileSync(join(root, path), 'utf8')
          )
        )
      expect(reaching).toEqual(['methods/workbench-validation.ts'])
    })
  })
})

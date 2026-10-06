import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOT_INGRESS_PRINCIPAL_ID } from '../../../../shared/dot-ingress/dot-ingress-limits'
import {
  WorkbenchRunListParams,
  WorkbenchRunMessageParams,
  WorkbenchRunShowParams,
  WorkbenchRunStopParams
} from '../../../../shared/rpc-contract/workbench-run-params'
import {
  RunMessageSendResultSchema,
  WorkflowRunListResultSchema,
  WorkflowRunShowResultSchema
} from '../../../../shared/workflow-run/workflow-run-view'
import { getPrimarySessionStore } from '../../orchestration/db/primary-session-store'
import { getWorkflowRunStore } from '../../orchestration/db/workflow-run-store'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import { settleWorkbenchLaunches, waitForWorkbenchLaunch } from '../../workbench-intake-launch'
import { submitWorkbenchRequest } from '../../workbench-intake-submit'
import { createFakePrimarySessionRuntime } from '../../workbench-intake.test-fixture'
import {
  FIXTURE_ONLY_PRINCIPAL,
  FIXTURE_ONLY_WORKSPACE,
  createRuntimeHarness,
  type RuntimeHarness
} from '../../workbench-routing/workbench-runtime.test-fixture'
import { setPrimarySessionRuntime } from '../../workflow-run/primary-session-runtime'
import type { RpcContext } from '../core'
import { RpcDispatcher } from '../dispatcher'
import {
  WORKBENCH_RUN_LIST_METHOD,
  WORKBENCH_RUN_MESSAGE_METHOD,
  WORKBENCH_RUN_METHODS,
  WORKBENCH_RUN_SHOW_METHOD,
  WORKBENCH_RUN_STOP_METHOD
} from './workbench-run'

let harness: RuntimeHarness | null = null

afterEach(async () => {
  await settleWorkbenchLaunches()
  setPrimarySessionRuntime(null)
  harness?.close()
  harness = null
  vi.restoreAllMocks()
})

function setup(options: { runtimeInstalled?: boolean } = {}) {
  const h = createRuntimeHarness()
  harness = h
  const fake = createFakePrimarySessionRuntime(h.owner)
  setPrimarySessionRuntime(options.runtimeInstalled === false ? null : fake.runtime)
  const orca = {
    getRuntimeId: vi.fn(() => 'fixture-runtime'),
    requireWorkbenchWorkspace: vi.fn(() => FIXTURE_ONLY_WORKSPACE),
    getOrchestrationDb: vi.fn(() => h.owner)
  }
  const context: RpcContext = {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the exercised run methods read this fixture's runtime members.
    runtime: orca as never,
    workbenchCaller: issueWorkbenchDesktopCaller()
  }
  return { h, orca, context, fake }
}

async function launch(h: RuntimeHarness, principalId = FIXTURE_ONLY_PRINCIPAL) {
  const target = {
    owner: h.owner,
    store: h.requests,
    principalId,
    workspace: FIXTURE_ONLY_WORKSPACE
  }
  const { request } = submitWorkbenchRequest(target, {
    workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId,
    objective: 'Inspect this change.',
    idempotencyKey: randomUUID()
  })
  await waitForWorkbenchLaunch(request.requestId)
  const run = getWorkflowRunStore(h.owner).getByRequestId(request.requestId)
  if (!run) {
    throw new Error('fixture run')
  }
  return { run, requestId: request.requestId }
}

function receiptStatus(h: RuntimeHarness, requestId: string): unknown {
  return h.owner.db
    .prepare('SELECT status FROM workbench_requests WHERE request_id = ?')
    .get(requestId)?.status
}

const PARAMS: Record<string, unknown> = {
  'workbench.runs.list': {},
  'workbench.runs.show': { runId: 'run_fixture999' },
  'workbench.runs.stop': { runId: 'run_fixture999' },
  'workbench.runs.message': {
    runId: 'run_fixture999',
    idempotencyKey: '8f18f989-8a86-423e-8e45-3416e01a14d2',
    text: 'Hello.'
  }
}

describe('workbench run methods', () => {
  it('declares list, show, stop and message with the shared params', () => {
    expect(WORKBENCH_RUN_METHODS.map((method) => method.name)).toEqual(Object.keys(PARAMS))
    expect(WORKBENCH_RUN_LIST_METHOD.params).toBe(WorkbenchRunListParams)
    expect(WORKBENCH_RUN_SHOW_METHOD.params).toBe(WorkbenchRunShowParams)
    expect(WORKBENCH_RUN_STOP_METHOD.params).toBe(WorkbenchRunStopParams)
    expect(WORKBENCH_RUN_MESSAGE_METHOD.params).toBe(WorkbenchRunMessageParams)
  })

  it('refuses every caller that is not the trusted desktop renderer, before any read or effect', async () => {
    const { orca, fake } = setup()
    const forged = Object.freeze({ principalId: 'local-desktop-ui', source: 'desktop_ui' as const })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the exercised run methods read this fixture's runtime members.
    const dispatcher = new RpcDispatcher({ runtime: orca as never, methods: WORKBENCH_RUN_METHODS })
    for (const options of [{}, { workbenchCaller: forged }]) {
      for (const [method, params] of Object.entries(PARAMS)) {
        const response = await dispatcher.dispatch(
          { id: 'fixture-request', authToken: 'fixture-local-token', method, params },
          options
        )
        expect(response, method).toMatchObject({
          ok: false,
          error: { code: 'workbench_forbidden' }
        })
      }
    }
    expect(orca.getOrchestrationDb).not.toHaveBeenCalled()
    expect(orca.requireWorkbenchWorkspace).not.toHaveBeenCalled()
    expect(fake.stopPrimarySession).not.toHaveBeenCalled()
    expect(fake.runtime.deliverRunMessage).not.toHaveBeenCalled()
  })

  it('lists runs as the shared view', async () => {
    const { h, context } = setup()
    const { run } = await launch(h)
    const result = WorkflowRunListResultSchema.parse(
      WORKBENCH_RUN_LIST_METHOD.handler(WorkbenchRunListParams.parse({}), context)
    )
    expect(result).toMatchObject({
      hasMore: false,
      runs: [{ runId: run.runId, status: 'active' }]
    })
  })

  it('shows one run with what its primary is doing now, without the terminal handle', async () => {
    const { h, context, fake } = setup()
    const { run } = await launch(h)
    vi.mocked(fake.runtime.readPrimarySessionStatus).mockImplementation(async (runId) => {
      const owner = getPrimarySessionStore(h.owner).latestForRun(runId)
      return owner
        ? { owner, status: { kind: 'live', handle: 'term_a', activity: 'dialog_open' } }
        : null
    })
    const shown = WorkflowRunShowResultSchema.parse(
      await WORKBENCH_RUN_SHOW_METHOD.handler({ runId: run.runId }, context)
    )
    expect(shown.run.primary?.live).toEqual({ kind: 'live', activity: 'dialog_open' })
    expect(JSON.stringify(shown)).not.toContain('term_a')
  })

  it('shows a run from stored records when no workflow runtime is installed', async () => {
    const { h, context } = setup()
    const { run } = await launch(h)
    setPrimarySessionRuntime(null)
    const shown = await WORKBENCH_RUN_SHOW_METHOD.handler({ runId: run.runId }, context)
    expect(shown.run.primary).toMatchObject({ state: 'running', live: null })
  })

  it('refuses an unknown run', async () => {
    const { context } = setup()
    await expect(
      WORKBENCH_RUN_SHOW_METHOD.handler({ runId: 'run_missing' }, context)
    ).rejects.toMatchObject({ code: 'workbench_run_not_found' })
  })
})

describe('workbench.runs.stop', () => {
  it('stops the primary, ends the run and cancels its receipt', async () => {
    const { h, context, fake } = setup()
    const { run, requestId } = await launch(h)
    const stopped = await WORKBENCH_RUN_STOP_METHOD.handler({ runId: run.runId }, context)
    expect(stopped).toMatchObject({
      changed: true,
      run: { status: 'canceled', endReason: 'user_canceled' }
    })
    expect(fake.stopPrimarySession).toHaveBeenCalledExactlyOnceWith(run.runId, 'user_canceled')
    expect(receiptStatus(h, requestId)).toBe('CANCELED')
    const again = await WORKBENCH_RUN_STOP_METHOD.handler({ runId: run.runId }, context)
    expect(again).toMatchObject({ changed: false, run: { status: 'canceled' } })
    expect(fake.stopPrimarySession).toHaveBeenCalledOnce()
  })

  it('lets the desktop stop a run dot started, canceling the dot receipt too', async () => {
    const { h, context } = setup()
    const { run, requestId } = await launch(h, DOT_INGRESS_PRINCIPAL_ID)
    await WORKBENCH_RUN_STOP_METHOD.handler({ runId: run.runId }, context)
    expect(receiptStatus(h, requestId)).toBe('CANCELED')
  })

  it('still ends the run when the receipt workspace is gone, leaving the receipt as it was', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { h, context, orca } = setup()
    const { run, requestId } = await launch(h)
    orca.requireWorkbenchWorkspace.mockImplementation(() => {
      throw new OrchestrationError('workbench_workspace_unavailable', 'gone')
    })
    const stopped = await WORKBENCH_RUN_STOP_METHOD.handler({ runId: run.runId }, context)
    expect(stopped).toMatchObject({ changed: true, run: { status: 'canceled' } })
    expect(receiptStatus(h, requestId)).toBe('LAUNCHED')
    expect(warn.mock.calls.flat().join(' ')).toContain('workbench_workspace_unavailable')
  })
})

describe('workbench.runs.message (D-019, desktop source)', () => {
  it('delivers through the run message service as the desktop', async () => {
    const { context, fake } = setup()
    const params = {
      runId: 'run_fixture999',
      idempotencyKey: randomUUID(),
      text: 'Also run the tests.'
    }
    const result = RunMessageSendResultSchema.parse(
      await WORKBENCH_RUN_MESSAGE_METHOD.handler(params, context)
    )
    expect(fake.runtime.deliverRunMessage).toHaveBeenCalledExactlyOnceWith({
      runId: params.runId,
      source: 'desktop',
      sourceRequestId: params.idempotencyKey,
      text: params.text
    })
    expect(result).toEqual({
      outcome: 'queued',
      reason: 'agent_busy',
      messageId: 'message_fixture01',
      state: 'received',
      duplicate: false
    })
  })

  it('refuses when workflow runs are not available', async () => {
    const { context } = setup({ runtimeInstalled: false })
    const params = { runId: 'run_fixture999', idempotencyKey: randomUUID(), text: 'Hello.' }
    await expect(WORKBENCH_RUN_MESSAGE_METHOD.handler(params, context)).rejects.toMatchObject({
      code: 'autopilot_primary_session_not_configured'
    })
  })
})

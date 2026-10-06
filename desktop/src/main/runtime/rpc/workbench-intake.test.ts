import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from './dispatcher'
import type { RpcRequest } from './core'
import { WORKBENCH_METHODS } from './methods/workbench'
import { issueWorkbenchDesktopCaller } from '../workbench-caller'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  setWorkbenchRoutingRuntime,
  type WorkbenchRoutingRuntime
} from '../workbench-routing/workbench-routing-runtime'

const { getStore, submit, list, cancel } = vi.hoisted(() => ({
  getStore: vi.fn(),
  submit: vi.fn(),
  list: vi.fn(),
  cancel: vi.fn()
}))

vi.mock('../orchestration/db/workbench-request-store', () => ({
  getWorkbenchRequestStore: getStore
}))

const workspace = {
  workspaceId: 'repo::C:\\work\\repo',
  projectId: 'project',
  projectKind: 'project' as const,
  hostId: 'local' as const,
  path: 'C:\\work\\repo'
}
const inputs = [
  {
    method: 'workbench.requests.submit',
    operation: 'submit',
    params: {
      workspaceId: 'worktree:repo::c:/WORK/REPO',
      objective: 'Inspect this change.',
      idempotencyKey: '8f18f989-8a86-423e-8e45-3416e01a14d2'
    }
  },
  {
    method: 'workbench.requests.list',
    operation: 'list',
    params: { workspaceId: 'worktree:repo::c:/WORK/REPO', limit: 10 }
  },
  {
    method: 'workbench.requests.cancel',
    operation: 'cancel',
    params: {
      workspaceId: 'worktree:repo::c:/WORK/REPO',
      requestId: 'request-one',
      expectedRevision: 1
    }
  }
] as const

function request(input: (typeof inputs)[number]): RpcRequest {
  return {
    id: 'fixture-request',
    authToken: 'fixture-local-token',
    method: input.method,
    params: input.params
  }
}

function fixture() {
  const owner = { fixtureDatabase: true }
  const runtime = {
    getRuntimeId: vi.fn(() => 'fixture-runtime'),
    requireWorkbenchWorkspace: vi.fn(() => workspace),
    getOrchestrationDb: vi.fn(() => owner)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the exercised Workbench methods read this fixture's runtime members.
  const dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: WORKBENCH_METHODS })
  return { dispatcher, runtime, owner }
}

function expectNoIntake(runtime: ReturnType<typeof fixture>['runtime']): void {
  expect(runtime.requireWorkbenchWorkspace).not.toHaveBeenCalled()
  expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
  expect(getStore).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
  expect(list).not.toHaveBeenCalled()
  expect(cancel).not.toHaveBeenCalled()
}

describe('Workbench dispatcher admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getStore.mockReturnValue({ submit, list, cancel })
    submit.mockReturnValue({ fixture: 'submitted' })
    list.mockReturnValue({ fixture: 'listed' })
    cancel.mockReturnValue({ fixture: 'canceled' })
  })

  it.each(inputs)(
    'rejects $method without an issued caller despite claimed transport identity',
    async (input) => {
      const { dispatcher, runtime } = fixture()
      const response = await dispatcher.dispatch(request(input), {
        clientId: 'desktop-renderer',
        clientKind: 'runtime',
        authenticatedCallerFingerprint: 'claimed-human'
      })
      expect(response).toMatchObject({ ok: false, error: { code: 'workbench_forbidden' } })
      expectNoIntake(runtime)
    }
  )

  it.each(inputs)(
    'rejects forged and copied caller objects for $method before admission',
    async (input) => {
      const issued = issueWorkbenchDesktopCaller()
      const impostors = [
        { principalId: issued.principalId, source: issued.source },
        Object.freeze({ ...issued }),
        JSON.parse(JSON.stringify(issued))
      ]
      for (const workbenchCaller of impostors) {
        const { dispatcher, runtime } = fixture()
        const response = await dispatcher.dispatch(request(input), { workbenchCaller })
        expect(response).toMatchObject({ ok: false, error: { code: 'workbench_forbidden' } })
        expectNoIntake(runtime)
      }
    }
  )

  it('ignores a caller object smuggled into the request envelope', async () => {
    const { dispatcher, runtime } = fixture()
    const envelope = {
      ...request(inputs[0]),
      workbenchCaller: issueWorkbenchDesktopCaller(),
      principalId: 'local-desktop-ui'
    }
    expect(await dispatcher.dispatch(envelope)).toMatchObject({
      ok: false,
      error: { code: 'workbench_forbidden' }
    })
    expectNoIntake(runtime)
  })

  it.each([
    'approved',
    'permissionState',
    'principalId',
    'workbenchCaller',
    'route',
    'executionSurface',
    'modelProfileId',
    'hostId',
    'projectId'
  ])('rejects caller-controlled %s parameters before admission', async (field) => {
    const { dispatcher, runtime } = fixture()
    const response = await dispatcher.dispatch(
      { ...request(inputs[0]), params: { ...inputs[0].params, [field]: 'claimed-authority' } },
      { workbenchCaller: issueWorkbenchDesktopCaller() }
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expectNoIntake(runtime)
  })

  it.each(inputs)(
    'uses only passive database acquisition and the trusted binding for $method',
    async (input) => {
      const { dispatcher, runtime, owner } = fixture()
      const caller = issueWorkbenchDesktopCaller()
      expect(await dispatcher.dispatch(request(input), { workbenchCaller: caller })).toMatchObject({
        ok: true
      })
      expect(runtime.requireWorkbenchWorkspace).toHaveBeenCalledExactlyOnceWith(
        input.params.workspaceId
      )
      expect(runtime.getOrchestrationDb).toHaveBeenCalledExactlyOnceWith({ passive: true })
      expect(getStore).toHaveBeenCalledExactlyOnceWith(owner)
      // Why: the RPC parse fills the D-018 default access before the store sees a submit.
      const parsedDefaults = input.operation === 'submit' ? { requestedAccess: 'read_only' } : {}
      expect({ submit, list, cancel }[input.operation]).toHaveBeenCalledExactlyOnceWith(
        caller.principalId,
        { ...input.params, ...parsedDefaults, workspaceId: workspace.workspaceId },
        workspace
      )
    }
  )

  it('passes an explicit access level and deliverable language through to the store', async () => {
    const { dispatcher } = fixture()
    const caller = issueWorkbenchDesktopCaller()
    const params = {
      ...inputs[0].params,
      requestedAccess: 'workspace_write',
      deliverableLanguage: 'de-CH'
    }
    expect(
      await dispatcher.dispatch({ ...request(inputs[0]), params }, { workbenchCaller: caller })
    ).toMatchObject({ ok: true })
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      caller.principalId,
      { ...params, workspaceId: workspace.workspaceId },
      workspace
    )
  })

  it.each(['workbench_workspace_unavailable', 'unsupported_host'])(
    'reports trusted workspace refusal %s before opening persistence',
    async (code) => {
      const { dispatcher, runtime } = fixture()
      runtime.requireWorkbenchWorkspace.mockImplementation(() => {
        throw new OrchestrationError(code, 'Fixture workspace refused.')
      })
      expect(
        await dispatcher.dispatch(request(inputs[0]), {
          workbenchCaller: issueWorkbenchDesktopCaller()
        })
      ).toMatchObject({ ok: false, error: { code } })
      expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
      expect(getStore).not.toHaveBeenCalled()
      expect(submit).not.toHaveBeenCalled()
    }
  )
})

describe('Workbench intake does not depend on routing', () => {
  const trustedCall = (input: (typeof inputs)[number]) => ({
    request: request(input),
    options: { workbenchCaller: issueWorkbenchDesktopCaller() }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getStore.mockReturnValue({ submit, list, cancel })
    submit.mockReturnValue({ fixture: 'submitted' })
    list.mockReturnValue({ fixture: 'listed' })
    cancel.mockReturnValue({ fixture: 'canceled' })
  })

  afterEach(() => {
    setWorkbenchRoutingRuntime(null)
  })

  it.each(inputs)(
    'passes no admission or routing summary to the store for $method, even with a runtime installed',
    async (input) => {
      const runtime: WorkbenchRoutingRuntime = {
        routingStatusView: vi.fn(),
        verifyClef: vi.fn(),
        pinClefProfile: vi.fn(),
        abortAllRouting: vi.fn(() => 0),
        reportFailure: vi.fn()
      }
      setWorkbenchRoutingRuntime(runtime)
      const { dispatcher } = fixture()
      const { request: envelope, options } = trustedCall(input)
      expect(await dispatcher.dispatch(envelope, options)).toMatchObject({ ok: true })
      const stored = { submit, list, cancel }[input.operation]
      expect(stored).toHaveBeenCalledTimes(1)
      expect(stored.mock.calls[0]).toHaveLength(3)
      expect(runtime.routingStatusView).not.toHaveBeenCalled()
      expect(runtime.verifyClef).not.toHaveBeenCalled()
    }
  )

  it.each([
    [
      'workbench.route.retry',
      { workspaceId: workspace.workspaceId, requestId: 'r', expectedRevision: 1 }
    ],
    ['workbench.route.decision.get', { workspaceId: workspace.workspaceId, requestId: 'r' }]
  ])(
    'answers method_not_found for the retired %s and opens no persistence',
    async (method, params) => {
      const { dispatcher, runtime } = fixture()
      const response = await dispatcher.dispatch(
        { id: 'fixture-request', authToken: 'fixture-local-token', method, params },
        { workbenchCaller: issueWorkbenchDesktopCaller() }
      )
      expect(response).toMatchObject({ ok: false, error: { code: 'method_not_found' } })
      expectNoIntake(runtime)
    }
  )
})

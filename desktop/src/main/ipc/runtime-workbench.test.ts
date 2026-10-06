import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, fromWebContentsMock, fromIdMock, getStore, submit, list, cancel } = vi.hoisted(
  () => ({
    handleMock: vi.fn(),
    fromWebContentsMock: vi.fn(),
    fromIdMock: vi.fn(),
    getStore: vi.fn(),
    submit: vi.fn(),
    list: vi.fn(),
    cancel: vi.fn()
  })
)

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: fromWebContentsMock, getAllWindows: vi.fn(() => []) },
  webContents: { fromId: fromIdMock },
  ipcMain: { handle: handleMock, on: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() }
}))
vi.mock('../runtime/orchestration/db/workbench-request-store', () => ({
  getWorkbenchRequestStore: getStore
}))

import { registerRuntimeHandlers } from './runtime'
import { setTrustedUIRendererWebContentsId, clearTrustedUIRendererWebContentsId } from './ui'

const workspace = {
  workspaceId: 'repo::C:\\work\\repo',
  projectId: 'project',
  projectKind: 'project' as const,
  hostId: 'local' as const,
  path: 'C:\\work\\repo'
}
const params = {
  workspaceId: workspace.workspaceId,
  objective: 'Inspect this change.',
  idempotencyKey: '8f18f989-8a86-423e-8e45-3416e01a14d2'
}
const callArgs = { method: 'workbench.requests.submit', params }
// Why: the RPC parse fills the D-018 default access before the store sees the submit.
const storedParams = { ...params, requestedAccess: 'read_only' }

function sender(id = 1) {
  return {
    id,
    mainFrame: {},
    isDestroyed: vi.fn(() => false),
    getType: vi.fn(() => 'window'),
    getURL: vi.fn(() => 'file:///fixture/index.html'),
    on: vi.fn(),
    once: vi.fn(),
    send: vi.fn()
  }
}

function registerPrimary(primary: ReturnType<typeof sender>): void {
  setTrustedUIRendererWebContentsId(primary.id)
  fromIdMock.mockImplementation((id) => (id === primary.id ? primary : null))
}

function fixture() {
  const runtime = {
    getRuntimeId: vi.fn(() => 'fixture-runtime'),
    requireWorkbenchWorkspace: vi.fn(() => workspace),
    getOrchestrationDb: vi.fn(() => ({ fixtureDatabase: true })),
    cleanupSubscriptionsForConnection: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture supplies every runtime member exercised by these Workbench IPC calls.
  registerRuntimeHandlers(runtime as never)
  const call = handleMock.mock.calls.find(([name]) => name === 'runtime:call')?.[1]
  expect(call).toBeTypeOf('function')
  return { runtime, call }
}

function expectNoIntake(runtime: ReturnType<typeof fixture>['runtime']): void {
  expect(runtime.requireWorkbenchWorkspace).not.toHaveBeenCalled()
  expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
  expect(getStore).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
}

describe('Workbench runtime IPC admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setTrustedUIRendererWebContentsId(null)
    fromIdMock.mockReturnValue(null)
    getStore.mockReturnValue({ submit, list, cancel })
    submit.mockReturnValue({ fixture: 'submitted' })
  })

  it('issues authority only for the actual registered primary webContents and current main frame', async () => {
    const primary = sender()
    registerPrimary(primary)
    const { runtime, call } = fixture()
    expect(await call({ sender: primary, senderFrame: primary.mainFrame }, callArgs)).toMatchObject(
      { ok: true }
    )
    expect(fromIdMock).toHaveBeenCalledWith(primary.id)
    expect(runtime.getOrchestrationDb).toHaveBeenCalledExactlyOnceWith({ passive: true })
    expect(submit).toHaveBeenCalledExactlyOnceWith('local-desktop-ui', storedParams, workspace)
  })

  it('rejects another window even when it claims the primary ID and file URL', async () => {
    const primary = sender()
    const clone = sender(primary.id)
    registerPrimary(primary)
    const { runtime, call } = fixture()
    await expect(call({ sender: clone, senderFrame: clone.mainFrame }, callArgs)).rejects.toThrow(
      'trusted application renderer'
    )
    expectNoIntake(runtime)
  })

  it('rejects missing registration rather than admitting any file URL', async () => {
    const primary = sender()
    fromIdMock.mockReturnValue(primary)
    const { runtime, call } = fixture()
    await expect(
      call({ sender: primary, senderFrame: primary.mainFrame }, callArgs)
    ).rejects.toThrow('trusted application renderer')
    expectNoIntake(runtime)
  })

  it('rejects a destroyed registered renderer', async () => {
    const primary = sender()
    primary.isDestroyed.mockReturnValue(true)
    registerPrimary(primary)
    const { runtime, call } = fixture()
    await expect(
      call({ sender: primary, senderFrame: primary.mainFrame }, callArgs)
    ).rejects.toThrow('trusted application renderer')
    expectNoIntake(runtime)
  })

  it('rejects child and replaced main frames before issuing caller authority', async () => {
    const primary = sender()
    registerPrimary(primary)
    const { runtime, call } = fixture()
    await expect(call({ sender: primary, senderFrame: {} }, callArgs)).rejects.toThrow(
      'current main frame'
    )
    expect(fromIdMock).not.toHaveBeenCalled()
    expectNoIntake(runtime)
  })

  it('does not recover authority from JSON or desktop client labels', async () => {
    const unregistered = sender(2)
    const { runtime, call } = fixture()
    await expect(
      call(
        { sender: unregistered, senderFrame: unregistered.mainFrame },
        {
          ...callArgs,
          clientId: 'desktop-renderer',
          workbenchCaller: { principalId: 'local-desktop-ui', source: 'desktop_ui' },
          approved: true
        }
      )
    ).rejects.toThrow('trusted application renderer')
    expectNoIntake(runtime)
  })

  it('does not pass an attacker-supplied principal through the trusted IPC boundary', async () => {
    const primary = sender()
    registerPrimary(primary)
    const { call } = fixture()
    expect(
      await call(
        { sender: primary, senderFrame: primary.mainFrame },
        {
          ...callArgs,
          clientId: 'attacker',
          workbenchCaller: { principalId: 'attacker', source: 'desktop_ui' }
        }
      )
    ).toMatchObject({ ok: true })
    expect(submit).toHaveBeenCalledExactlyOnceWith('local-desktop-ui', storedParams, workspace)
  })

  it('rejects permission fields in parameters before workspace or database access', async () => {
    const primary = sender()
    registerPrimary(primary)
    const { runtime, call } = fixture()
    expect(
      await call(
        { sender: primary, senderFrame: primary.mainFrame },
        { ...callArgs, params: { ...params, approved: true } }
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expectNoIntake(runtime)
  })

  it.each([
    [
      'workbench.route.retry',
      { workspaceId: workspace.workspaceId, requestId: 'r', expectedRevision: 1 }
    ],
    ['workbench.route.decision.get', { workspaceId: workspace.workspaceId, requestId: 'r' }]
  ])(
    'answers method_not_found for the retired %s even from the trusted renderer',
    async (method, retiredParams) => {
      const primary = sender()
      registerPrimary(primary)
      const { runtime, call } = fixture()
      expect(
        await call(
          { sender: primary, senderFrame: primary.mainFrame },
          { method, params: retiredParams }
        )
      ).toMatchObject({ ok: false, error: { code: 'method_not_found' } })
      expectNoIntake(runtime)
    }
  )

  it('retires the previous primary and admits only the newly registered object', async () => {
    const previous = sender(1)
    const current = sender(2)
    registerPrimary(previous)
    clearTrustedUIRendererWebContentsId(previous.id)
    registerPrimary(current)
    const { runtime, call } = fixture()
    await expect(
      call({ sender: previous, senderFrame: previous.mainFrame }, callArgs)
    ).rejects.toThrow('trusted application renderer')
    expectNoIntake(runtime)
    expect(await call({ sender: current, senderFrame: current.mainFrame }, callArgs)).toMatchObject(
      { ok: true }
    )
    expect(submit).toHaveBeenCalledTimes(1)
  })
})

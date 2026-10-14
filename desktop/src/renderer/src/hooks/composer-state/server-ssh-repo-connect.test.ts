// @vitest-environment happy-dom
// #25887: a workspace on a paired server's own SSH target must be connected by that server.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {}
  return { state, connectRuntimeEnvironmentSshTarget: vi.fn() }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign((select: (state: unknown) => unknown) => select(mocks.state), {
    getState: () => mocks.state
  })
}))
vi.mock('@/runtime/runtime-environment-ssh-state', () => ({
  connectRuntimeEnvironmentSshTarget: mocks.connectRuntimeEnvironmentSshTarget,
  hydrateRuntimeEnvironmentSshState: vi.fn(async () => {})
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { useHostRuntimeEffects } = await import('./host-runtime-effects')

const sshConnect = vi.fn()

function renderEffects(repoId: string, targetId: string) {
  return renderHook(() =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the connect path reads only the refs and store set here; the rest are inert stubs.
    useHostRuntimeEffects({
      commitHookCheckIfCurrent: vi.fn(),
      connectionId: null,
      disabledTuiAgents: [],
      ensureDetectedAgents: vi.fn(async () => []),
      ensureRemoteDetectedAgents: vi.fn(async () => []),
      ensureRuntimeDetectedAgents: vi.fn(async () => []),
      fallbackDefaultAgent: null,
      folderTargetConnectionId: null,
      isRemote: false,
      loadHookCheckForRepo: vi.fn(),
      newWorkspaceDraft: null,
      repoId: null,
      repoIdRef: { current: repoId },
      runtimeEnvironmentId: null,
      selectedRepoConnectionIdRef: { current: targetId },
      selectedRepoHookContextKey: null,
      selectedRepoIsGit: false,
      selectedRepoSshStatus: null,
      setTuiAgent: vi.fn(),
      settings: null,
      tuiAgent: 'claude'
    } as unknown as Parameters<typeof useHostRuntimeEffects>[0])
  )
}

describe('connecting the SSH target of the selected project', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, { api: { ssh: { connect: sshConnect } } })
  })

  it("asks the server to connect its own SSH target, never this client's", async () => {
    mocks.state = {
      repos: [
        {
          id: 'repo-dike',
          connectionId: 'ssh-dike',
          executionHostId: 'runtime:env-1'
        }
      ],
      sshConnectionStates: new Map()
    }
    const { result } = renderEffects('repo-dike', 'ssh-dike')

    await act(() => result.current.onConnectSelectedRepo())

    expect(mocks.connectRuntimeEnvironmentSshTarget).toHaveBeenCalledWith('env-1', 'ssh-dike')
    expect(sshConnect).not.toHaveBeenCalled()
  })

  it("connects this client's own SSH target locally, as before", async () => {
    mocks.state = {
      repos: [{ id: 'repo-local', connectionId: 'ssh-mine', executionHostId: 'ssh:ssh-mine' }],
      sshConnectionStates: new Map()
    }
    const { result } = renderEffects('repo-local', 'ssh-mine')

    await act(() => result.current.onConnectSelectedRepo())

    expect(sshConnect).toHaveBeenCalledWith({ targetId: 'ssh-mine' })
    expect(mocks.connectRuntimeEnvironmentSshTarget).not.toHaveBeenCalled()
  })
})

describe("agents for a project on a paired server's SSH host", () => {
  it("are detected by the server, never by probing this client's SSH connections", async () => {
    mocks.state = {
      remoteDetectedAgentIds: {},
      runtimeDetectedAgentIds: {},
      detectedAgentIds: null,
      ensureDetectedAgents: vi.fn(),
      ensureRemoteDetectedAgents: vi.fn(),
      ensureRuntimeDetectedAgents: vi.fn()
    }
    const { useWorkspaceIdentityState } = await import('./workspace-identity-state')

    const { result } = renderHook(() =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: identity state reads only these fields; the rest are inert.
      useWorkspaceIdentityState({
        persistDraft: false,
        newWorkspaceDraft: null,
        selectedRepoConnectionId: 'ssh-dike',
        selectedRepoRuntimeEnvironmentId: 'env-1',
        settings: null
      } as unknown as Parameters<typeof useWorkspaceIdentityState>[0])
    )

    expect(result.current.isRemote).toBe(false)
    // Attachment uploads still name the worktree's real host.
    expect(result.current.connectionId).toBe('ssh-dike')
    expect(result.current.runtimeEnvironmentId).toBe('env-1')
  })
})

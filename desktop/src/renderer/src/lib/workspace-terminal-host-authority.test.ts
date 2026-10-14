/**
 * The seeding predicate answers one question for both remote flavors: does some other party own
 * terminal creation for this workspace right now? Three answers, and only `none` seeds.
 */
import { describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { createTestStore, makeWorktree } from '@/store/slices/store-test-helpers'
import { ensureWorktreeHasInitialTerminal } from '@/lib/worktree-initial-terminal-seeding'
import { resolveWorkspaceTerminalHostAuthority } from '@/lib/workspace-terminal-host-authority'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

type TestStore = ReturnType<typeof createTestStore>

const LOCAL_WORKTREE_ID = 'repoLocal::/home/dev/proj/feature'
const SSH_WORKTREE_ID = 'repoSsh::/srv/proj/feature'
const PAIRED_WORKTREE_ID = 'repoPaired::/srv/proj/paired'
const TARGET_ID = 'ssh-target-1'
const ENVIRONMENT_ID = 'runtime-env-1'

function repo(id: string, path: string, connectionId?: string): never {
  return {
    id,
    path,
    displayName: id,
    badgeColor: '#000',
    addedAt: 0,
    ...(connectionId ? { connectionId } : {})
  } as never
}

function seedLocal(store: TestStore): void {
  store.setState({
    repos: [repo('repoLocal', '/home/dev/proj')],
    worktreesByRepo: {
      repoLocal: [
        makeWorktree({
          id: LOCAL_WORKTREE_ID,
          repoId: 'repoLocal',
          path: '/home/dev/proj/feature',
          hostId: 'local'
        } as never)
      ]
    }
  })
}

function seedDirectSsh(store: TestStore): void {
  store.setState({
    repos: [repo('repoSsh', '/srv/proj', TARGET_ID)],
    worktreesByRepo: {
      repoSsh: [
        makeWorktree({
          id: SSH_WORKTREE_ID,
          repoId: 'repoSsh',
          path: '/srv/proj/feature',
          hostId: `ssh:${TARGET_ID}`
        } as never)
      ]
    }
  })
}

function connectTarget(store: TestStore): void {
  store.getState().setSshConnectionState(TARGET_ID, {
    targetId: TARGET_ID,
    status: 'connected',
    error: null,
    reconnectAttempt: 0
  })
}

function terminalTabCount(store: TestStore, worktreeId: string): number {
  return (store.getState().tabsByWorktree[worktreeId] ?? []).length
}

describe('workspace terminal seeding authority', () => {
  it('seeds a purely local workspace immediately, exactly once', () => {
    const store = createTestStore()
    seedLocal(store)

    expect(resolveWorkspaceTerminalHostAuthority(store.getState(), LOCAL_WORKTREE_ID)).toBe('none')

    // No await, no host round trip: the client is the execution host for a local workspace.
    const tabId = ensureWorktreeHasInitialTerminal(store.getState(), LOCAL_WORKTREE_ID)
    expect(tabId).toBeTruthy()
    expect(terminalTabCount(store, LOCAL_WORKTREE_ID)).toBe(1)

    // A second activation pass must not add another.
    ensureWorktreeHasInitialTerminal(store.getState(), LOCAL_WORKTREE_ID)
    expect(terminalTabCount(store, LOCAL_WORKTREE_ID)).toBe(1)
  })

  it('seeds once the SSH target connects, with no workspace snapshot to wait for', () => {
    // The relay that served host workspace snapshots is gone (#27214), so nothing will ever answer
    // one; waiting for it left a reconnected target unable to seed or resume for good.
    const store = createTestStore()
    seedDirectSsh(store)
    expect(resolveWorkspaceTerminalHostAuthority(store.getState(), SSH_WORKTREE_ID)).toBe(
      'unverifiable'
    )

    connectTarget(store)
    expect(resolveWorkspaceTerminalHostAuthority(store.getState(), SSH_WORKTREE_ID)).toBe('none')
    expect(ensureWorktreeHasInitialTerminal(store.getState(), SSH_WORKTREE_ID)).toBeTruthy()
    expect(terminalTabCount(store, SSH_WORKTREE_ID)).toBe(1)
  })

  it('stops seeding when the SSH target drops', () => {
    const store = createTestStore()
    seedDirectSsh(store)
    connectTarget(store)
    store.getState().setSshConnectionState(TARGET_ID, {
      targetId: TARGET_ID,
      status: 'reconnecting',
      error: null,
      reconnectAttempt: 1
    })

    expect(resolveWorkspaceTerminalHostAuthority(store.getState(), SSH_WORKTREE_ID)).toBe(
      'unverifiable'
    )
    expect(ensureWorktreeHasInitialTerminal(store.getState(), SSH_WORKTREE_ID)).toBeNull()
  })

  it('leaves a worktree emptied on purpose empty at startup, even once its target connected', () => {
    const store = createTestStore()
    seedDirectSsh(store)
    connectTarget(store)
    store.setState({
      tabsByWorktree: { [SSH_WORKTREE_ID]: [] },
      closedTerminalTabTombstonesByTabId: {
        closed: { closedAt: Date.now(), worktreeId: SSH_WORKTREE_ID }
      }
    })

    // Startup restore passes no reseed option; only an explicit activation does.
    expect(ensureWorktreeHasInitialTerminal(store.getState(), SSH_WORKTREE_ID)).toBeNull()
    expect(terminalTabCount(store, SSH_WORKTREE_ID)).toBe(0)
    expect(
      ensureWorktreeHasInitialTerminal(
        store.getState(),
        SSH_WORKTREE_ID,
        undefined,
        undefined,
        undefined,
        undefined,
        { reseedEmptiedWorkspace: true }
      )
    ).toBeTruthy()
  })

  it('leaves terminal creation to the host of a paired runtime workspace', () => {
    const store = createTestStore()
    store.setState({
      repos: [repo('repoPaired', '/srv/proj')],
      worktreesByRepo: {
        repoPaired: [
          makeWorktree({
            id: PAIRED_WORKTREE_ID,
            repoId: 'repoPaired',
            path: '/srv/proj/paired',
            hostId: `runtime:${ENVIRONMENT_ID}`,
            runtimeOwnerEnvironmentId: ENVIRONMENT_ID
          } as never)
        ]
      }
    })

    expect(resolveWorkspaceTerminalHostAuthority(store.getState(), PAIRED_WORKTREE_ID)).toBe('live')
    expect(ensureWorktreeHasInitialTerminal(store.getState(), PAIRED_WORKTREE_ID)).toBeNull()
    expect(terminalTabCount(store, PAIRED_WORKTREE_ID)).toBe(0)
  })

  /**
   * #15556: the guard this replaces asked "am I a client of a live paired session?". Rival detected
   * publications make the owning environment unnameable, so that guard answered "no" and the client
   * seeded a local terminal beside the one the host was creating. Ownership is unresolved, not local.
   */
  it('does not seed locally when the runtime owner cannot be named', () => {
    const store = createTestStore()
    store.setState({
      repos: [repo('repoPaired', '/srv/proj')],
      worktreesByRepo: {},
      detectedWorktreesByRepo: {
        repoPaired: {
          authoritative: true,
          worktrees: [
            makeWorktree({
              id: PAIRED_WORKTREE_ID,
              repoId: 'repoPaired',
              path: '/srv/proj/paired',
              hostId: `runtime:${ENVIRONMENT_ID}`,
              runtimeOwnerEnvironmentId: ENVIRONMENT_ID
            } as never)
          ]
        },
        repoPairedRival: {
          authoritative: true,
          worktrees: [
            makeWorktree({
              id: PAIRED_WORKTREE_ID,
              repoId: 'repoPairedRival',
              path: '/srv/proj/paired',
              hostId: 'local'
            } as never)
          ]
        }
      } as never
    })

    expect(resolveWorkspaceTerminalHostAuthority(store.getState(), PAIRED_WORKTREE_ID)).toBe(
      'unverifiable'
    )
    expect(ensureWorktreeHasInitialTerminal(store.getState(), PAIRED_WORKTREE_ID)).toBeNull()
    expect(terminalTabCount(store, PAIRED_WORKTREE_ID)).toBe(0)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import type { AgentSessionOwnerBinding } from '../../shared/agent-session-host-authority'
import { clearProviderPtyState } from './pty/provider/state-cleanup'
import { setLocalPtyProvider } from './pty/provider/registry'

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../agent-hooks/server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../pwsh', () => import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock()))
vi.mock('../wsl', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../agent-hooks/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../codex/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../codex/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)

describe('registerPtyHandlers', () => {
  const {
    createAgentClaimProvider,
    recoveredAgentClaim,
    recoveredAgentSurface,
    registerAgentClaimController
  } = setupPtyIpcSuite()

  it('does not adopt a stale generation when its PTY id is reused without ownership', async () => {
    const claim = {
      ...recoveredAgentClaim,
      identityDigest: 'fffffffffffffffffffffffffffffffffffffffffff'
    }
    const oldOwner: AgentSessionOwnerBinding = {
      claim,
      generation: 'generation-old',
      phase: 'live',
      ptyId: 'pty-reused',
      surface: recoveredAgentSurface
    }
    const sessions = [
      {
        id: oldOwner.ptyId,
        incarnationId: 'incarnation-old',
        cwd: '/tmp/recovered-worktree',
        title: 'Codex',
        agentSessionOwners: [oldOwner]
      }
    ]
    const spawn = vi.fn(
      async (options: {
        agentSessionEnsure?: { claim: typeof claim; surface: typeof recoveredAgentSurface }
      }) => {
        const ensured = options.agentSessionEnsure
        if (!ensured) {
          throw new Error('missing test claim')
        }
        const owner: AgentSessionOwnerBinding = {
          claim: ensured.claim,
          generation: 'generation-new',
          phase: 'live',
          ptyId: 'pty-new-owner',
          surface: ensured.surface
        }
        sessions.push({
          id: owner.ptyId,
          incarnationId: 'incarnation-new',
          cwd: '/tmp/recovered-worktree',
          title: 'Codex',
          agentSessionOwners: [owner]
        })
        return {
          id: owner.ptyId,
          agentSessionEnsure: { disposition: 'created' as const, owner }
        }
      }
    )
    const provider = createAgentClaimProvider({ sessions, spawn })
    setLocalPtyProvider(provider as never)
    const controller = registerAgentClaimController()
    const request = {
      cols: 80,
      rows: 24,
      cwd: '/tmp/recovered-worktree',
      agentSessionEnsure: { claim, surface: recoveredAgentSurface }
    }

    await expect(controller.spawn(request)).resolves.toMatchObject({ id: oldOwner.ptyId })
    sessions[0] = { ...sessions[0], agentSessionOwners: [] }
    await expect(controller.spawn(request)).resolves.toMatchObject({
      id: 'pty-new-owner',
      agentSessionEnsure: { disposition: 'created' }
    })
    expect(spawn).toHaveBeenCalledOnce()

    clearProviderPtyState(oldOwner.ptyId)
    clearProviderPtyState('pty-new-owner')
  })
})

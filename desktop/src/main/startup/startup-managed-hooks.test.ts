import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_HOOK_TARGETS } from '../../shared/agent-hook-types'

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  probeClaudeVersion: vi.fn(),
  ensureRealHomeCodexHookState: vi.fn(),
  recordFailure: vi.fn(),
  installers: new Map<string, ReturnType<typeof vi.fn>>()
}))

vi.mock('../agent-hooks/local-agent-cli-presence', () => ({
  detectLocalManagedAgentCliPresence: mocks.detect
}))
vi.mock('../claude/claude-hook-event-versions', () => ({
  probeClaudeCliVersion: mocks.probeClaudeVersion
}))
vi.mock('../codex/codex-real-home-hook-install', () => ({
  ensureRealHomeCodexHookState: mocks.ensureRealHomeCodexHookState
}))
vi.mock('../agent-hooks/install-telemetry', () => ({
  recordManagedHookInstallFailure: mocks.recordFailure
}))
vi.mock('../agent-hooks/managed-agent-hook-registry', async () => {
  const { AGENT_HOOK_TARGETS: targets } = await import('../../shared/agent-hook-types')
  return {
    MANAGED_AGENT_HOOK_INSTALLERS: targets.map((agent) => {
      const install = vi.fn(() => ({
        agent,
        state: 'installed',
        configPath: `/${agent}`,
        managedHooksPresent: true,
        detail: null
      }))
      mocks.installers.set(agent, install)
      return [agent, install] as const
    }),
    MANAGED_AGENT_HOOK_REMOVERS: [],
    MANAGED_AGENT_HOOK_SCRIPT_REFRESHERS: [],
    MANAGED_AGENT_HOOK_ASYNC_REMOVERS: [],
    MANAGED_AGENT_HOOK_STATUS_READERS: []
  }
})

import {
  reconcileStartupManagedHooks,
  type StartupManagedHookContext
} from './startup-managed-hooks'

function context(overrides: Partial<StartupManagedHookContext> = {}): StartupManagedHookContext {
  return {
    managedHooksAllowed: true,
    settings: () => ({ agentStatusHooksEnabled: true, disabledTuiAgents: [] }),
    isQuitting: () => false,
    hydrateShellPath: false,
    userDataPath: () => 'C:\\Users\\me\\AppData\\Roaming\\NASH',
    isRealCodexHomeSelected: () => true,
    ...overrides
  }
}

function installedAgents(): string[] {
  return [...mocks.installers.entries()]
    .filter(([, install]) => install.mock.calls.length > 0)
    .map(([agent]) => agent)
}

describe('startup managed hook reconciliation in NASH', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.probeClaudeVersion.mockResolvedValue(null)
    mocks.ensureRealHomeCodexHookState.mockResolvedValue('installed')
    mocks.detect.mockImplementation(async (targets: readonly { agent: string }[]) =>
      Object.fromEntries(targets.map(({ agent }) => [agent, { state: 'found' }]))
    )
  })

  it('runs only the Claude Code installer, with every CLI installed', async () => {
    await reconcileStartupManagedHooks(context())
    expect(installedAgents()).toEqual(['claude'])
    expect(mocks.installers.size).toBe(AGENT_HOOK_TARGETS.length)
  })

  it("never writes Codex's hooks into the real ~/.codex at startup", async () => {
    await reconcileStartupManagedHooks(context())
    expect(mocks.ensureRealHomeCodexHookState).not.toHaveBeenCalled()
  })

  it('installs nothing when the hooks switch is off or the build may not touch user hooks', async () => {
    await reconcileStartupManagedHooks(
      context({ settings: () => ({ agentStatusHooksEnabled: false }) })
    )
    await reconcileStartupManagedHooks(context({ managedHooksAllowed: false }))
    expect(installedAgents()).toEqual([])
    expect(mocks.detect).not.toHaveBeenCalled()
  })

  it('stops before installing once the app is quitting', async () => {
    await reconcileStartupManagedHooks(context({ isQuitting: () => true }))
    expect(installedAgents()).toEqual([])
  })

  it('never rejects when CLI detection fails', async () => {
    mocks.detect.mockRejectedValueOnce(new Error('detection unavailable'))
    await expect(reconcileStartupManagedHooks(context())).resolves.toBeUndefined()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_HOOK_TARGETS, type AgentHookTarget } from '../../shared/agent-hook-types'

function status(agent: AgentHookTarget, state: 'installed' | 'not_installed') {
  return {
    agent,
    state,
    configPath: `/${agent}`,
    managedHooksPresent: state === 'installed',
    detail: null
  } as const
}

const mocks = vi.hoisted(() => {
  const probed: string[][] = []
  return {
    detect: vi.fn(),
    probed,
    probeClaudeVersion: vi.fn(),
    installers: new Map<AgentHookTarget, ReturnType<typeof vi.fn>>(),
    removers: new Map<AgentHookTarget, ReturnType<typeof vi.fn>>(),
    refreshers: new Map<AgentHookTarget, ReturnType<typeof vi.fn>>()
  }
})

vi.mock('./local-agent-cli-presence', () => ({
  detectLocalManagedAgentCliPresence: mocks.detect
}))

vi.mock('../claude/claude-hook-event-versions', () => ({
  probeClaudeCliVersion: mocks.probeClaudeVersion
}))

// Why every target: the scope must hold against the full registry, not a two-agent sample.
vi.mock('./managed-agent-hook-registry', async () => {
  const { AGENT_HOOK_TARGETS: targets } = await import('../../shared/agent-hook-types')
  const entry = (map: Map<AgentHookTarget, ReturnType<typeof vi.fn>>, agent: AgentHookTarget) => {
    const fn = vi.fn()
    map.set(agent, fn)
    return [agent, fn] as const
  }
  return {
    MANAGED_AGENT_HOOK_INSTALLERS: targets.map((agent) => entry(mocks.installers, agent)),
    MANAGED_AGENT_HOOK_REMOVERS: targets.map((agent) => entry(mocks.removers, agent)),
    MANAGED_AGENT_HOOK_SCRIPT_REFRESHERS: targets.map((agent) => entry(mocks.refreshers, agent)),
    MANAGED_AGENT_HOOK_ASYNC_REMOVERS: [],
    MANAGED_AGENT_HOOK_STATUS_READERS: []
  }
})

import { NASH_MANAGED_HOOK_AGENTS } from './nash-managed-hook-scope'
import {
  applyAgentStatusHooksEnabled,
  installManagedAgentHooks,
  isAgentStatusHooksEnabledForAgent,
  removeManagedAgentHooks,
  shouldContinueManagedHookStartup
} from './managed-agent-hook-controls'

const OTHER_AGENTS = AGENT_HOOK_TARGETS.filter((agent) => agent !== 'claude')
const ENABLED = { agentStatusHooksEnabled: true, disabledTuiAgents: [] }

describe('NASH managed hook scope (user decision of 2026-10-06: "Claude Code only")', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.probed.length = 0
    for (const [agent, install] of mocks.installers) {
      install.mockReturnValue(status(agent, 'installed'))
    }
    for (const [agent, remove] of mocks.removers) {
      remove.mockReturnValue(status(agent, 'not_installed'))
    }
    for (const refresh of mocks.refreshers.values()) {
      refresh.mockResolvedValue(undefined)
    }
    mocks.probeClaudeVersion.mockResolvedValue(null)
    mocks.detect.mockImplementation(async (targets: readonly { agent: string }[]) => {
      mocks.probed.push(targets.map(({ agent }) => agent))
      return Object.fromEntries(targets.map(({ agent }) => [agent, { state: 'found' }]))
    })
  })

  it('is one constant naming Claude Code alone', () => {
    expect(NASH_MANAGED_HOOK_AGENTS).toEqual(['claude'])
  })

  it('runs only the Claude installer, even when every CLI is installed', async () => {
    const results = await installManagedAgentHooks(ENABLED)

    expect(mocks.installers.get('claude')).toHaveBeenCalledTimes(1)
    for (const agent of OTHER_AGENTS) {
      expect(mocks.installers.get(agent), agent).not.toHaveBeenCalled()
    }
    // Why: no other CLI is even probed, so detection spawns nothing on their behalf.
    expect(mocks.probed).toEqual([['claude']])
    expect(results.find((result) => result.agent === 'claude')).toMatchObject({
      state: 'installed'
    })
    for (const agent of ['openclaude', 'codex', 'gemini', 'antigravity', 'cursor'] as const) {
      expect(results.find((result) => result.agent === agent)).toMatchObject({
        state: 'skipped',
        skipReason: 'hooks_disabled',
        detail: 'NASH installs managed status hooks only for Claude Code.'
      })
    }
  })

  it('installs nothing when only other agents are asked for', async () => {
    await installManagedAgentHooks(ENABLED, { agents: ['codex', 'gemini', 'cursor'] })
    for (const install of mocks.installers.values()) {
      expect(install).not.toHaveBeenCalled()
    }
  })

  it('keeps the Settings switch to Claude alone', async () => {
    await applyAgentStatusHooksEnabled(true, ENABLED)
    expect(mocks.installers.get('claude')).toHaveBeenCalledTimes(1)
    for (const agent of OTHER_AGENTS) {
      expect(mocks.installers.get(agent), agent).not.toHaveBeenCalled()
    }
  })

  it("keeps Orca's removal for every agent, so an older config can still be cleaned", async () => {
    await removeManagedAgentHooks()
    for (const agent of AGENT_HOOK_TARGETS) {
      expect(mocks.removers.get(agent), agent).toHaveBeenCalledTimes(1)
    }
    vi.clearAllMocks()
    await applyAgentStatusHooksEnabled(false)
    for (const agent of AGENT_HOOK_TARGETS) {
      expect(mocks.removers.get(agent), agent).toHaveBeenCalledTimes(1)
    }
  })

  it('gates every startup and launch-time hook write to Claude', () => {
    expect(shouldContinueManagedHookStartup(false, ENABLED, 'claude')).toBe(true)
    expect(isAgentStatusHooksEnabledForAgent(ENABLED, 'claude')).toBe(true)
    for (const agent of ['openclaude', 'codex', 'gemini', 'antigravity', 'cursor'] as const) {
      expect(shouldContinueManagedHookStartup(false, ENABLED, agent), agent).toBe(false)
      expect(isAgentStatusHooksEnabledForAgent(ENABLED, agent), agent).toBe(false)
    }
  })

  it('still honours the global off switch and a disabled Claude', () => {
    expect(isAgentStatusHooksEnabledForAgent({ agentStatusHooksEnabled: false }, 'claude')).toBe(
      false
    )
    expect(
      isAgentStatusHooksEnabledForAgent(
        { agentStatusHooksEnabled: true, disabledTuiAgents: ['claude'] },
        'claude'
      )
    ).toBe(false)
  })
})

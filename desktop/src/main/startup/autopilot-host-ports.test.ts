// FIXTURE_ONLY: every producer is a fake seam; nothing here spawns a CLI, opens a socket or reads a credential.
import { describe, expect, it, vi } from 'vitest'
import type { TuiAgent } from '../../shared/tui-agent'
import { createAutopilotHostPorts, type AutopilotHostSeams } from './autopilot-host-ports'

const DISABLED: TuiAgent[] = ['antigravity']
const MODEL = { id: 'fixture-model', label: 'Fixture model', isDefault: true, efforts: [] }

function seams(overrides: Partial<AutopilotHostSeams> = {}) {
  const resolvers = {
    resolveCodexEnvironment: vi.fn(async () => ({ PATH: '/fixture/bin' })),
    resolveClaudeInheritedEnv: vi.fn(async () => ({ PATH: '/fixture/bin' }))
  }
  const claudeProbe = vi.fn(async (_home: string) => ({ models: [MODEL] }))
  const codexProbe = vi.fn(async (_home: string) => ({ models: [MODEL] }))
  const all: AutopilotHostSeams = {
    detectInstalled: vi.fn(async () => ['claude', 'codex']),
    createEnvironmentResolvers: vi.fn(() => resolvers),
    // Why through the deps: a real probe takes its environment from them, which is what starts the shell.
    createClaudeProbe: vi.fn((deps) => async (home: string) => {
      await deps.resolveInheritedEnv?.()
      return claudeProbe(home)
    }),
    createCodexProbe: vi.fn((deps) => async (home: string) => {
      await deps.resolveEnvironment?.()
      return codexProbe(home)
    }),
    discoverModels: vi.fn(async () => ({ success: false as const, error: 'fixture' })),
    resolveCodexExecutable: vi.fn(() => {
      throw new Error('Fixture: no codex.')
    }),
    resolveAgyExecutable: vi.fn(() => {
      throw new Error('Fixture: no agy.')
    }),
    resolveClaudeLaunchTarget: vi.fn(() => null),
    ...overrides
  }
  return { all, resolvers, claudeProbe, codexProbe }
}

function build(overrides: Partial<AutopilotHostSeams> = {}) {
  const fakes = seams(overrides)
  const settings = vi.fn(() => ({
    disabledTuiAgents: DISABLED,
    agentDefaultEnv: {}
  }))
  const state = { claude: null, codex: null, antigravity: null }
  const service = {
    getState: vi.fn(() => state),
    refresh: vi.fn(async () => ({})),
    onAccountChange: vi.fn(() => () => undefined)
  }
  const rateLimits = vi.fn((): typeof service | null => service)
  const runtime = {
    resolveStructuredAgentAccountHome: vi.fn(async (agent: 'claude' | 'codex') => ({
      variable: agent === 'claude' ? ('CLAUDE_CONFIG_DIR' as const) : ('CODEX_HOME' as const),
      path: `/fixture/home/${agent}`
    }))
  }
  const ports = createAutopilotHostPorts({
    runtime,
    settings,
    rateLimits,
    now: () => 1_000,
    seams: fakes.all
  })
  return { ports, settings, service, rateLimits, runtime, ...fakes }
}

describe('createAutopilotHostPorts: nothing runs until a route is checked', () => {
  it('builds every port without calling any producer, the settings or the account resolver', () => {
    const { all, settings, rateLimits, runtime } = build()
    for (const seam of Object.values(all)) {
      expect(seam).not.toHaveBeenCalled()
    }
    expect(settings).not.toHaveBeenCalled()
    expect(rateLimits).not.toHaveBeenCalled()
    expect(runtime.resolveStructuredAgentAccountHome).not.toHaveBeenCalled()
  })

  it('takes the login-shell environment once, on the first listing, and shares it', async () => {
    const { ports, all } = build()
    await ports.models.claude()
    await ports.models.codex()
    await ports.models.claude()
    expect(all.createEnvironmentResolvers).toHaveBeenCalledTimes(1)
    expect(all.createClaudeProbe).toHaveBeenCalledTimes(1)
    expect(all.createCodexProbe).toHaveBeenCalledTimes(1)
  })
})

describe('createAutopilotHostPorts: listings', () => {
  it('lists each CLI under the account home a structured launch would pin', async () => {
    const { ports, claudeProbe, codexProbe } = build()
    expect(await ports.models.claude()).toMatchObject({ ok: true, observedAtMs: 1_000 })
    expect(await ports.models.codex()).toMatchObject({ ok: true })
    expect(claudeProbe).toHaveBeenCalledWith('/fixture/home/claude')
    expect(codexProbe).toHaveBeenCalledWith('/fixture/home/codex')
  })

  it('answers a failed probe or discovery as unobserved and never rejects', async () => {
    const { ports } = build({
      createClaudeProbe: vi.fn(() => async () => {
        throw new Error('Fixture: probe failed.')
      })
    })
    expect(await ports.models.claude()).toEqual({ ok: false, observedAtMs: 1_000 })
    expect(await ports.models.agy()).toEqual({ ok: false, observedAtMs: 1_000 })
  })
})

describe('createAutopilotHostPorts: agents, limits and executables', () => {
  it('reads the disabled agents from the settings on every check', () => {
    const { ports, settings } = build()
    expect([...(ports.agents.disabled() ?? [])]).toEqual(['antigravity'])
    expect([...(ports.agents.disabled() ?? [])]).toEqual(['antigravity'])
    expect(settings).toHaveBeenCalledTimes(2)
  })

  it('reads and refreshes the rate-limit service, and reads null without one', async () => {
    const { ports, service, rateLimits } = build()
    expect(ports.rateLimits.read()).toBe(service.getState())
    await ports.rateLimits.refresh()
    expect(service.refresh).toHaveBeenCalledTimes(1)
    rateLimits.mockReturnValue(null)
    expect(ports.rateLimits.read()).toBeNull()
    await expect(ports.rateLimits.refresh()).resolves.toBeNull()
  })

  it('tells route checks that usage comes only from the CLIs (user instruction 2026-10-06)', () => {
    const { ports, rateLimits } = build()
    expect(ports.rateLimits.usageSource).toBe('cli-native')
    expect(rateLimits).not.toHaveBeenCalled()
  })

  it('resolves the executables only when asked', () => {
    const { ports, all } = build()
    expect(() => ports.codex.resolveExecutable()).toThrow(/no codex/)
    expect(() => ports.agy.resolveExecutable()).toThrow(/no agy/)
    expect(ports.claude.resolveExecutable()).toBeNull()
    expect(all.resolveClaudeLaunchTarget).toHaveBeenCalledTimes(1)
  })
})

import { describe, expect, it } from 'vitest'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import { resolveStructuredAgentSessionCreateSupport } from './structured-agent-session-create-support'

const LOCAL: AgentSessionExecutionLocation = {
  executionHostId: 'local',
  wslDistro: null,
  workspaceId: 'workspace-1',
  workspaceKind: 'git-worktree'
}

function support(
  overrides: Partial<Parameters<typeof resolveStructuredAgentSessionCreateSupport>[0]> = {}
) {
  return resolveStructuredAgentSessionCreateSupport({
    agent: 'claude',
    location: LOCAL,
    adapterSupportsCreate: true,
    getSettings: () => ({}),
    ...overrides
  })
}

describe('resolveStructuredAgentSessionCreateSupport', () => {
  it('supports Claude on the user own login', () => {
    expect(support()).toEqual({ supported: true })
  })

  it('ignores retired managed-account keys a profile may still carry', () => {
    // FIXTURE_ONLY: a WSL-only selection used to refuse structured Claude.
    const retired = {
      agentCmdOverrides: {},
      claudeManagedAccounts: [{ id: 'wsl-1', managedAuthRuntime: 'wsl' }],
      activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: { Ubuntu: 'wsl-1' } }
    }
    expect(support({ getSettings: () => retired })).toEqual({ supported: true })
  })

  it('keeps supporting Claude when the settings throw', () => {
    expect(
      support({
        getSettings: () => {
          throw new Error('no store')
        }
      })
    ).toEqual({ supported: true })
  })

  it.each([
    ['remote', { ...LOCAL, executionHostId: 'ssh:host-a' }, 'remote'],
    ['wsl workspace', { ...LOCAL, wslDistro: 'Ubuntu' }, 'wsl'],
    ['unsupported agent', LOCAL, 'agent']
  ] as const)('keeps the adapter refusal reason for %s', (_name, location, reason) => {
    expect(support({ adapterSupportsCreate: false, location })).toEqual({
      supported: false,
      reason
    })
  })

  it.each(['claude', 'codex'] as const)(
    "refuses %s when this host overrides the agent's launch command",
    (agent) => {
      expect(
        support({
          agent,
          getSettings: () => ({ agentCmdOverrides: { [agent]: 'wrapper' } })
        })
      ).toEqual({ supported: false, reason: 'agent' })
    }
  )

  it('ignores a blank launch command override', () => {
    expect(support({ getSettings: () => ({ agentCmdOverrides: { claude: '  ' } }) })).toEqual({
      supported: true
    })
  })
})

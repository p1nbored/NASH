import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ScopeModule from './nash-managed-hook-scope'

// Why an override: Orca's detection mechanics need agents outside NASH's Claude-only scope.
const scope = vi.hoisted(() => ({ override: null as readonly string[] | null }))
vi.mock('./nash-managed-hook-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof ScopeModule>()
  return {
    ...actual,
    isNashManagedHookAgent: (agent: string) =>
      scope.override ? scope.override.includes(agent) : actual.isNashManagedHookAgent(agent)
  }
})

import {
  buildManagedHookDetectionCommands,
  detectedManagedHookAgents,
  readManagedHookDetectionResult
} from './managed-hook-detection-commands'

describe('NASH scope for SSH and WSL guest installs', () => {
  beforeEach(() => {
    scope.override = null
  })

  it('probes only Claude Code on a remote host', () => {
    const commands = buildManagedHookDetectionCommands(null, 'linux')

    expect(commands.length).toBeGreaterThan(0)
    expect(commands.every((command) => command.id === 'claude')).toBe(true)
  })

  it('installs for Claude Code only, whatever the remote reports', () => {
    expect(detectedManagedHookAgents(['claude', 'codex', 'gemini', 'droid'])).toEqual(['claude'])
    expect(readManagedHookDetectionResult({ agents: ['codex', 'claude'] }).agents).toEqual([
      'claude'
    ])
  })
})

describe('managed hook detection commands', () => {
  beforeEach(() => {
    scope.override = ['claude', 'codex', 'droid']
  })

  it('omits disabled agents and includes safe command overrides', () => {
    const commands = buildManagedHookDetectionCommands(
      {
        disabledTuiAgents: ['claude'],
        agentCmdOverrides: { codex: '/opt/codex custom' }
      },
      'linux'
    )

    expect(commands.some((command) => command.id === 'claude')).toBe(false)
    expect(commands).toContainEqual({ id: 'codex', cmd: '/opt/codex' })
  })

  it('maps detected TUI ids back to managed hook targets', () => {
    expect(detectedManagedHookAgents(['codex', 'opencode', 'droid'])).toEqual(['codex', 'droid'])
  })

  it('requests a version only for Claude capability detection', () => {
    const commands = buildManagedHookDetectionCommands(null, 'linux')

    expect(commands.find((command) => command.id === 'claude')).toMatchObject({
      reportVersion: true
    })
    expect(commands.find((command) => command.id === 'codex')?.reportVersion).toBeUndefined()
  })
})

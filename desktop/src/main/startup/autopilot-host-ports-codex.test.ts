// FIXTURE_ONLY: Orca's Codex resolver is mocked; no installed Codex is looked up or started.
import { describe, expect, it, vi } from 'vitest'
import type * as CodexExecutableModule from '../codex-exec/codex-exec-executable'
import type { CodexExecutable } from '../codex-exec/codex-exec-executable'
import { createAutopilotHostPorts } from './autopilot-host-ports'

// What typing `codex` resolves to after an npm install: node plus the package's own launcher.
const LAUNCHER: CodexExecutable = {
  program: 'C:\\fixture\\nodejs\\node.exe',
  prefixArgs: ['C:\\fixture\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'],
  entryPath: 'C:\\fixture\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
  requestedPath: 'C:\\fixture\\npm\\codex.cmd',
  launch: 'node-entry',
  source: 'path-search',
  electronRunAsNode: false
}

const resolver = vi.hoisted(() => ({ resolve: vi.fn() }))

vi.mock('../codex-exec/codex-exec-executable', async (importOriginal) => ({
  ...(await importOriginal<typeof CodexExecutableModule>()),
  resolveCodexExecutable: resolver.resolve
}))

describe('the production Codex resolver', () => {
  it("starts Codex through the vendor's installed launcher, as typing codex in a shell does", () => {
    resolver.resolve.mockReturnValue(LAUNCHER)
    const ports = createAutopilotHostPorts({
      runtime: { resolveStructuredAgentAccountHome: vi.fn() },
      settings: vi.fn(),
      rateLimits: () => null
    })
    expect(resolver.resolve).not.toHaveBeenCalled()
    expect(ports.codex.resolveExecutable()).toBe(LAUNCHER)
    expect(resolver.resolve).toHaveBeenCalledTimes(1)
    expect(resolver.resolve).toHaveBeenCalledWith({ kind: 'installed' })
  })
})

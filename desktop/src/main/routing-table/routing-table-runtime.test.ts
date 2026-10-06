import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CodexExecutable } from '../codex-exec/codex-exec-executable'
import { createMemoryAvailabilityFs } from './availability/route-availability-fs.test-fixture'
import {
  AGY_MODELS,
  CLAUDE_MODELS,
  CODEX_MODELS,
  NOW_MS,
  headroomOf,
  listingOf
} from './availability/route-availability.test-fixture'
import { ensureActiveRoutingTable, resolveActiveRoutingTable } from './routing-table-activation'
import { createRoutingTableRuntime, type RoutingTableRuntimePorts } from './routing-table-runtime'
import {
  FIXTURE_USER_DATA,
  createTestRoutingTableEnvironment
} from './routing-table-test-context.test-fixture'

const EXECUTABLE: CodexExecutable = {
  program: 'codex',
  prefixArgs: [],
  entryPath: 'codex',
  requestedPath: 'codex',
  launch: 'direct',
  source: 'path-search',
  electronRunAsNode: false
}

function ports(
  env: ReturnType<typeof createTestRoutingTableEnvironment>,
  refreshes: { count: number },
  availabilityFs = createMemoryAvailabilityFs(() => NOW_MS)
): RoutingTableRuntimePorts {
  return {
    now: () => NOW_MS,
    routingTable: env.ctx,
    files: { paths: { getUserDataPath: () => FIXTURE_USER_DATA }, fs: availabilityFs },
    agents: {
      detectInstalled: async () => ['claude', 'codex', 'antigravity'],
      disabled: () => []
    },
    models: {
      claude: async () => listingOf(CLAUDE_MODELS),
      codex: async () => listingOf(CODEX_MODELS),
      agy: async () => listingOf(AGY_MODELS)
    },
    rateLimits: {
      read: () => headroomOf(),
      refresh: async () => {
        refreshes.count += 1
      }
    },
    codex: { resolveExecutable: () => EXECUTABLE }
  }
}

describe('createRoutingTableRuntime', () => {
  it('serves the active table to the resolver and to callers that only read it', async () => {
    const env = createTestRoutingTableEnvironment()
    ensureActiveRoutingTable(env.ctx)
    const runtime = createRoutingTableRuntime(ports(env, { count: 0 }))
    expect(runtime.activeTable()).toEqual(resolveActiveRoutingTable(env.ctx))
    const resolution = await runtime.resolver.resolveRoute({
      taskType: 'scientific_experiment_validation',
      workspace: { kind: 'git-worktree' }
    })
    expect(resolution.ok && resolution.route.availability).toMatchObject({
      status: 'available',
      cli: { model: 'gpt-6-astra', effort: 'max', effortDelivery: 'codex_config_override' }
    })
  })

  it('reads the rate limits through the bounded refresh, never refreshing for a cached read', async () => {
    const env = createTestRoutingTableEnvironment()
    ensureActiveRoutingTable(env.ctx)
    const refreshes = { count: 0 }
    const runtime = createRoutingTableRuntime(ports(env, refreshes))
    await runtime.resolver.resolveRoute({ taskType: 'software_engineering', freshness: 'cached' })
    expect(refreshes.count).toBe(0)
    await runtime.resolver.resolveRoute({ taskType: 'software_engineering' })
    expect(refreshes.count).toBe(1)
  })

  it('keeps latches beside the routing table, so a restart still holds the route', async () => {
    const env = createTestRoutingTableEnvironment()
    ensureActiveRoutingTable(env.ctx)
    const files = createMemoryAvailabilityFs(() => NOW_MS)
    const first = createRoutingTableRuntime(ports(env, { count: 0 }, files))
    const resolved = await first.resolver.resolveRoute({ taskType: 'general_research_analysis' })
    if (!resolved.ok) {
      throw new Error('route not resolved')
    }
    first.resolver.latch(resolved.route.availability.subject, 'quota')
    expect([...files.files.keys()]).toContain(
      join(FIXTURE_USER_DATA, 'routing-table', 'availability.json')
    )
    const second = createRoutingTableRuntime(ports(env, { count: 0 }, files))
    const held = await second.resolver.resolveRoute({ taskType: 'general_research_analysis' })
    expect(held.ok && held.route.availability).toMatchObject({
      status: 'unavailable',
      reasons: ['quota_exhausted']
    })
  })
})

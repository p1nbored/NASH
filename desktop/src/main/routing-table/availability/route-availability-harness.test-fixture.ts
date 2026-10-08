// FIXTURE_ONLY: fake ports for the route availability evaluator; no CLI, network or file system is touched.
import type { RateLimitHeadroomState } from './route-provider-headroom'
import type { CodexExecutable } from '../../codex-exec/codex-exec-executable'
import { FIXTURE_USER_DATA } from '../routing-table-test-context.test-fixture'
import type { ModelListing } from './model-listing'
import {
  createMemoryAvailabilityFs,
  type MemoryAvailabilityFs
} from './route-availability-fs.test-fixture'
import {
  createRouteAvailabilityEvaluator,
  type AvailabilityPorts,
  type EvaluatorWaits
} from './route-availability-evaluator'
import { createRouteAvailabilityStore } from './route-availability-store'
import type { RouteProvider } from './route-availability-types'
import {
  AGY_MODELS,
  CLAUDE_MODELS,
  CODEX_MODELS,
  NOW_MS,
  headroomOf,
  limitsOf,
  listingOf
} from './route-availability.test-fixture'

export type HarnessOverrides = {
  detected?: () => Promise<readonly string[]>
  disabled?: () => Iterable<unknown> | null | undefined
  models?: Partial<Record<RouteProvider, () => Promise<ModelListing>>>
  readRateLimits?: () => RateLimitHeadroomState | null
  refreshRateLimits?: () => Promise<unknown>
  resolveCodexExecutable?: () => CodexExecutable
  waits?: Partial<EvaluatorWaits>
  fs?: MemoryAvailabilityFs
}

const FAKE_EXECUTABLE: CodexExecutable = {
  program: 'codex',
  prefixArgs: [],
  entryPath: 'codex',
  requestedPath: 'codex',
  launch: 'direct',
  source: 'path-search',
  electronRunAsNode: false
}

export function createEvaluatorHarness(overrides: HarnessOverrides = {}) {
  const clock = { nowMs: NOW_MS }
  const calls = { detect: 0, claude: 0, codex: 0, agy: 0, read: 0, refresh: 0, executable: 0 }
  const fs = overrides.fs ?? createMemoryAvailabilityFs(() => clock.nowMs)
  const freshReadings = (): RateLimitHeadroomState =>
    headroomOf({
      claude: limitsOf('claude', { updatedAt: clock.nowMs - 1_000 }),
      codex: limitsOf('codex', { updatedAt: clock.nowMs - 1_000 }),
      antigravity: limitsOf('antigravity', { updatedAt: clock.nowMs - 1_000 })
    })
  const listingPort =
    (provider: RouteProvider, rows: Parameters<typeof listingOf>[0]) => async () => {
      calls[provider] += 1
      return listingOf(rows, clock.nowMs)
    }
  const ports: AvailabilityPorts = {
    now: () => clock.nowMs,
    detection: {
      detectInstalled:
        overrides.detected ??
        (async () => {
          calls.detect += 1
          return ['claude', 'codex', 'antigravity']
        }),
      disabled: overrides.disabled ?? (() => [])
    },
    models: {
      claude: overrides.models?.claude ?? listingPort('claude', CLAUDE_MODELS),
      codex: overrides.models?.codex ?? listingPort('codex', CODEX_MODELS),
      agy: overrides.models?.agy ?? listingPort('agy', AGY_MODELS)
    },
    rateLimits: {
      read: () => {
        calls.read += 1
        return (overrides.readRateLimits ?? freshReadings)()
      },
      refresh: async () => {
        calls.refresh += 1
        return overrides.refreshRateLimits?.()
      }
    },
    resolveCodexExecutable: () => {
      calls.executable += 1
      return (overrides.resolveCodexExecutable ?? (() => FAKE_EXECUTABLE))()
    }
  }
  const store = createRouteAvailabilityStore({
    paths: { getUserDataPath: () => FIXTURE_USER_DATA },
    fs,
    now: () => clock.nowMs
  })
  const evaluator = createRouteAvailabilityEvaluator({ ports, store, waits: overrides.waits })
  return { clock, calls, ports, store, fs, evaluator }
}

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURE_USER_DATA } from '../routing-table-test-context.test-fixture'
import { CodexExecutableError } from '../../codex-exec/codex-exec-executable'
import type { ModelListing } from './model-listing'
import { createEvaluatorHarness } from './route-availability-harness.test-fixture'
import { createMemoryAvailabilityFs } from './route-availability-fs.test-fixture'
import {
  CODEX_MODELS,
  NOW_MS,
  failedListing,
  listingOf,
  subjectOf
} from './route-availability.test-fixture'

const codex = subjectOf('codex_cli', 'gpt-6.1-sol', 'max')
const claudeSubagent = subjectOf('claude_subagent', 'claude-opus-5-5', 'max')
const claudeHeadless = subjectOf('claude_headless', 'claude-sonnet-5-5', 'high')
const agy = subjectOf('agy_cli', 'gemini-3.8-flash-high', 'high', 'if_supported')
const DISPATCH = { freshness: 'dispatch', workspace: { kind: 'git-worktree' } } as const
const MINUTE = 60_000
const LATCH_FILE = join(FIXTURE_USER_DATA, 'routing-table', 'availability.json')

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('evaluate', () => {
  it('evaluates a route end to end and records what it observed and when', async () => {
    const h = createEvaluatorHarness()
    const [result] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(result).toMatchObject({ status: 'available', reasons: [], subject: codex })
    expect(result?.cli).toMatchObject({ model: 'gpt-6.1-sol', effort: 'max' })
    expect(result?.snapshot).toMatchObject({
      freshness: 'dispatch',
      workspaceKind: 'git-worktree',
      checkedAtMs: NOW_MS,
      observedAtMs: { detection: NOW_MS, models: NOW_MS, rateLimits: NOW_MS - 1_000 }
    })
  })

  it('reads each source once for a whole batch, and returns results in subject order', async () => {
    const h = createEvaluatorHarness()
    const results = await h.evaluator.evaluate(
      [agy, codex, claudeSubagent, claudeHeadless],
      DISPATCH
    )
    expect(results.map((result) => result.subject)).toEqual([
      agy,
      codex,
      claudeSubagent,
      claudeHeadless
    ])
    expect(results.map((result) => result.status)).toEqual([
      'available',
      'available',
      'available',
      'available'
    ])
    expect(h.calls).toMatchObject({ detect: 1, claude: 1, codex: 1, agy: 1, executable: 1 })
  })

  it('reads only the providers the batch needs', async () => {
    const h = createEvaluatorHarness()
    await h.evaluator.evaluate([codex], DISPATCH)
    expect(h.calls).toMatchObject({ claude: 0, agy: 0, codex: 1, executable: 1 })
    const other = createEvaluatorHarness()
    await other.evaluator.evaluate([claudeSubagent], DISPATCH)
    expect(other.calls).toMatchObject({ claude: 1, codex: 0, agy: 0, executable: 0 })
  })

  it('shares one listing probe between concurrent evaluations', async () => {
    const h = createEvaluatorHarness()
    await Promise.all([
      h.evaluator.evaluate([codex], DISPATCH),
      h.evaluator.evaluate([codex], DISPATCH)
    ])
    expect(h.calls.codex).toBe(1)
  })

  it('turns a throwing rate-limit source into an unobserved login, never a rejection', async () => {
    const h = createEvaluatorHarness({
      readRateLimits: () => {
        throw new Error('service down')
      }
    })
    const [result] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(result).toMatchObject({ status: 'unverified', reasons: ['auth_unobserved'] })
  })

  it('turns a failed detection into an unobserved cli', async () => {
    const h = createEvaluatorHarness({
      detected: async () => {
        throw new Error('detection failed')
      }
    })
    const [result] = await h.evaluator.evaluate([claudeSubagent], DISPATCH)
    expect(result).toMatchObject({ status: 'unverified', reasons: ['cli_unobserved'] })
  })

  it('feeds a codex launch-target failure into the cli check', async () => {
    const h = createEvaluatorHarness({
      resolveCodexExecutable: () => {
        throw new CodexExecutableError('invalid_selection', 'not a launcher')
      }
    })
    const [result] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(result).toMatchObject({ status: 'unavailable', reasons: ['cli_not_launchable'] })
  })
})

describe('workspace', () => {
  it('makes a codex route in the floating terminal unavailable', async () => {
    const h = createEvaluatorHarness()
    const [result] = await h.evaluator.evaluate([codex], {
      freshness: 'dispatch',
      workspace: { workspaceId: 'global-floating-terminal' }
    })
    expect(result).toMatchObject({ status: 'unavailable', reasons: ['workspace_not_git'] })
  })

  it('makes a codex route in a folder workspace available (D-027)', async () => {
    const h = createEvaluatorHarness()
    const [result] = await h.evaluator.evaluate([codex], {
      freshness: 'dispatch',
      workspace: { workspaceId: 'folder:folder-1' }
    })
    expect(result).toMatchObject({ status: 'available', reasons: [] })
    expect(result?.snapshot.workspaceKind).toBe('folder')
  })

  it('passes a git worktree id, and accepts a kind directly', async () => {
    const h = createEvaluatorHarness()
    const byId = await h.evaluator.evaluate([codex], {
      freshness: 'dispatch',
      workspace: { workspaceId: 'repo-1::/work/tree' }
    })
    expect(byId[0]?.snapshot.workspaceKind).toBe('git-worktree')
    expect(byId[0]?.status).toBe('available')
    const byKind = await h.evaluator.evaluate([codex], {
      freshness: 'dispatch',
      workspace: { kind: 'floating' }
    })
    expect(byKind[0]?.status).toBe('unavailable')
  })

  it('makes no workspace claim without a workspace', async () => {
    const h = createEvaluatorHarness()
    const [result] = await h.evaluator.evaluate([codex], { freshness: 'dispatch' })
    expect(result?.snapshot.workspaceKind).toBeNull()
    expect(result?.snapshot.checks.some((check) => check.check === 'workspace')).toBe(false)
  })

  it('does not hold a Claude or agy route to the workspace kind', async () => {
    const h = createEvaluatorHarness()
    const results = await h.evaluator.evaluate([claudeSubagent, agy], {
      freshness: 'dispatch',
      workspace: { kind: 'folder' }
    })
    expect(results.map((result) => result.status)).toEqual(['available', 'available'])
  })
})

describe('freshness', () => {
  it('reuses a listing younger than ten minutes and a detection younger than a minute at dispatch', async () => {
    const h = createEvaluatorHarness()
    await h.evaluator.evaluate([codex], DISPATCH)
    h.clock.nowMs += 30_000
    await h.evaluator.evaluate([codex], DISPATCH)
    expect(h.calls).toMatchObject({ codex: 1, detect: 1 })
    h.clock.nowMs += 9 * MINUTE
    await h.evaluator.evaluate([codex], DISPATCH)
    expect(h.calls).toMatchObject({ codex: 1, detect: 2 })
  })

  it('reads a listing older than ten minutes again at dispatch', async () => {
    const h = createEvaluatorHarness()
    await h.evaluator.evaluate([codex], DISPATCH)
    h.clock.nowMs += 10 * MINUTE + 1
    await h.evaluator.evaluate([codex], DISPATCH)
    expect(h.calls.codex).toBe(2)
  })

  it('reads everything again on a re-check', async () => {
    const h = createEvaluatorHarness()
    await h.evaluator.evaluate([codex], DISPATCH)
    await h.evaluator.evaluate([codex], {
      freshness: 'recheck',
      workspace: { kind: 'git-worktree' }
    })
    expect(h.calls).toMatchObject({ codex: 2, detect: 2 })
  })

  it('never starts a probe for a cached read, which can only report what is held', async () => {
    const h = createEvaluatorHarness()
    const [empty] = await h.evaluator.evaluate([codex], { freshness: 'cached' })
    expect(empty).toMatchObject({ status: 'unverified' })
    expect(empty?.reasons).toEqual(
      expect.arrayContaining(['cli_unobserved', 'model_list_unavailable'])
    )
    expect(h.calls).toMatchObject({ detect: 0, codex: 0, refresh: 0 })
    await h.evaluator.evaluate([codex], DISPATCH)
    h.clock.nowMs += 2 * 60 * MINUTE
    const [held] = await h.evaluator.evaluate([codex], { freshness: 'cached' })
    expect(h.calls).toMatchObject({ detect: 1, codex: 1 })
    expect(held?.snapshot.observedAtMs.models).toBe(NOW_MS)
  })

  it('does not probe again within the failure window, then tries once more', async () => {
    let probes = 0
    const h = createEvaluatorHarness({
      models: {
        codex: async () => {
          probes += 1
          return failedListing(h.clock.nowMs)
        }
      }
    })
    const [first] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(first).toMatchObject({ status: 'unverified', reasons: ['model_list_unavailable'] })
    h.clock.nowMs += 20_000
    await h.evaluator.evaluate([codex], DISPATCH)
    expect(probes).toBe(1)
    h.clock.nowMs += 11_000
    await h.evaluator.evaluate([codex], DISPATCH)
    expect(probes).toBe(2)
  })

  it('stops waiting for a slow listing, reports it unobserved, and keeps what it later returns', async () => {
    const slow = deferred<ModelListing>()
    let probes = 0
    const h = createEvaluatorHarness({
      waits: { dispatchMs: 15, recheckMs: 15 },
      models: {
        codex: () => {
          probes += 1
          return slow.promise
        }
      }
    })
    const [timedOut] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(timedOut).toMatchObject({ status: 'unverified', reasons: ['model_list_unavailable'] })
    slow.resolve(listingOf(CODEX_MODELS, h.clock.nowMs))
    await new Promise((done) => setTimeout(done, 5))
    const [later] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(later?.status).toBe('available')
    expect(probes).toBe(1)
  })
})

describe('a damaged latch file', () => {
  const damagedHarness = () => {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(LATCH_FILE, '{not json', NOW_MS - 10 * MINUTE)
    return createEvaluatorHarness({ fs })
  }

  it('holds every route although the live checks pass, and says the file is the source', async () => {
    const h = damagedHarness()
    const results = await h.evaluator.evaluate([codex, claudeSubagent], DISPATCH)
    for (const result of results) {
      expect(result).toMatchObject({ status: 'unavailable', cli: null })
      expect(result.reasons).toEqual(['auth_failed', 'quota_exhausted'])
      expect(result.snapshot.checks.filter((check) => check.check === 'latch')).toHaveLength(2)
      expect(result.snapshot.checks.at(-1)).toMatchObject({
        evidence: { source: 'availability_file_damaged' }
      })
    }
  })

  it('does not lift the hold on a dispatch check, only on a re-check with a newer passing reading', async () => {
    const h = damagedHarness()
    h.clock.nowMs += 5 * MINUTE
    const [held] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(held?.status).toBe('unavailable')
    const [released] = await h.evaluator.evaluate([codex], { freshness: 'recheck' })
    expect(released?.status).toBe('available')
    const [other] = await h.evaluator.evaluate([claudeSubagent], DISPATCH)
    expect(other?.status).toBe('unavailable')
    const [after] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(after?.status).toBe('available')
  })

  it('keeps a route held when the re-check only has readings older than the damaged file', async () => {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(LATCH_FILE, '{not json', NOW_MS + MINUTE)
    const h = createEvaluatorHarness({ fs })
    const [result] = await h.evaluator.evaluate([codex], { freshness: 'recheck' })
    expect(result?.status).toBe('unavailable')
  })
})

describe('slow or forgotten observations', () => {
  it('stops waiting for a detection that never returns and reports the cli unobserved', async () => {
    const never = new Promise<readonly string[]>(() => {})
    const h = createEvaluatorHarness({
      waits: { dispatchMs: 15, recheckMs: 15 },
      detected: () => never
    })
    const [result] = await h.evaluator.evaluate([claudeSubagent], DISPATCH)
    expect(result).toMatchObject({ status: 'unverified', reasons: ['cli_unobserved'] })
  })

  it('forgets cached listings and detection on invalidate, so an account switch is read again', async () => {
    const h = createEvaluatorHarness()
    await h.evaluator.evaluate([codex], DISPATCH)
    h.evaluator.invalidate()
    await h.evaluator.evaluate([codex], DISPATCH)
    expect(h.calls).toMatchObject({ codex: 2, detect: 2 })
  })

  it('does not let a probe that settles after invalidate repopulate the cache', async () => {
    const slow = deferred<ModelListing>()
    let probes = 0
    const h = createEvaluatorHarness({
      waits: { dispatchMs: 15, recheckMs: 15 },
      models: {
        codex: () => {
          probes += 1
          return probes === 1
            ? slow.promise
            : Promise.resolve(listingOf(CODEX_MODELS, h.clock.nowMs))
        }
      }
    })
    await h.evaluator.evaluate([codex], DISPATCH)
    h.evaluator.invalidate()
    slow.resolve(listingOf(CODEX_MODELS, h.clock.nowMs))
    await new Promise((done) => setTimeout(done, 5))
    const [result] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(probes).toBe(2)
    expect(result?.status).toBe('available')
  })

  it('keeps the latches when it forgets the observations', async () => {
    const h = createEvaluatorHarness()
    h.evaluator.latch(codex, 'auth')
    h.evaluator.invalidate()
    const [result] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(result?.status).toBe('unavailable')
  })
})

describe('rate limits', () => {
  it('asks for a bounded refresh at dispatch, at most once a minute', async () => {
    const h = createEvaluatorHarness()
    await h.evaluator.evaluate([codex], DISPATCH)
    h.clock.nowMs += 30_000
    await h.evaluator.evaluate([codex], DISPATCH)
    expect(h.calls.refresh).toBe(1)
    h.clock.nowMs += 31_000
    await h.evaluator.evaluate([codex], DISPATCH)
    expect(h.calls.refresh).toBe(2)
  })

  it('refreshes on a re-check even inside that minute, and never for a cached read', async () => {
    const h = createEvaluatorHarness()
    await h.evaluator.evaluate([codex], DISPATCH)
    await h.evaluator.evaluate([codex], { freshness: 'recheck' })
    expect(h.calls.refresh).toBe(2)
    await h.evaluator.evaluate([codex], { freshness: 'cached' })
    expect(h.calls.refresh).toBe(2)
  })

  it('does not wait for a refresh once the caller has aborted', async () => {
    const never = new Promise<unknown>(() => {})
    const h = createEvaluatorHarness({ refreshRateLimits: () => never })
    const controller = new AbortController()
    controller.abort()
    const [result] = await h.evaluator.evaluate([codex], { ...DISPATCH, signal: controller.signal })
    expect(result?.status).toBe('available')
  })
})

describe('latches', () => {
  it('holds a route that an executor reported as failing, although the live checks pass', async () => {
    const h = createEvaluatorHarness()
    h.evaluator.latch(codex, 'auth')
    const [result] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(result).toMatchObject({ status: 'unavailable', reasons: ['auth_failed'], cli: null })
    expect(result?.snapshot.checks.some((check) => check.check === 'latch')).toBe(true)
    const [cached] = await h.evaluator.evaluate([codex], { freshness: 'cached' })
    expect(cached?.status).toBe('unavailable')
  })

  it('latches only the route that failed', async () => {
    const h = createEvaluatorHarness()
    h.evaluator.latch(codex, 'quota')
    const other = subjectOf('codex_cli', 'gpt-6-astra', 'max')
    const results = await h.evaluator.evaluate([codex, other], DISPATCH)
    expect(results.map((result) => result.status)).toEqual(['unavailable', 'available'])
  })

  it('keeps the latch across a dispatch check and clears it on a re-check with a newer passing reading', async () => {
    const h = createEvaluatorHarness()
    h.evaluator.latch(codex, 'auth')
    h.clock.nowMs += 5 * MINUTE
    const [stillHeld] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(stillHeld?.status).toBe('unavailable')
    const [released] = await h.evaluator.evaluate([codex], { freshness: 'recheck' })
    expect(released?.status).toBe('available')
    expect(h.store.latchesFor('codex_cli|gpt-6.1-sol|max')).toEqual([])
    const [after] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(after?.status).toBe('available')
  })

  it('persists the latch so a restart still holds the route', async () => {
    const h = createEvaluatorHarness()
    h.evaluator.latch(codex, 'auth')
    const restarted = createEvaluatorHarness({ fs: h.fs })
    const [result] = await restarted.evaluator.evaluate([codex], DISPATCH)
    expect(result?.status).toBe('unavailable')
  })
})

it.each(['claude_primary', 'claude_workflow'] as const)(
  'checks actual Codex availability for legacy %s target',
  async (target) => {
    const h = createEvaluatorHarness({ detected: async () => ['codex'] })
    const subject = subjectOf(target, 'gpt-6.1-sol', 'max', 'required', false, 'codex')
    const [result] = await h.evaluator.evaluate([subject], DISPATCH)
    expect(result).toMatchObject({
      status: 'available',
      cli: { target, model: 'gpt-6.1-sol', effortDelivery: 'codex_config_override' }
    })
    expect(h.calls).toMatchObject({ claude: 0, codex: 1, executable: 1 })
  }
)

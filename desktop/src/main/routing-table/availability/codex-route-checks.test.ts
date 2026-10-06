import { describe, expect, it } from 'vitest'
import { CodexExecutableError, type CodexExecutable } from '../../codex-exec/codex-exec-executable'
import { checkCodexRoute, readCodexExecutable } from './codex-route-checks'
import type { ListedModel } from './model-listing'
import {
  CODEX_MODELS,
  NOW_MS,
  detectionOf,
  failedListing,
  headroomOf,
  limitsOf,
  listingOf,
  observationsOf,
  subjectOf
} from './route-availability.test-fixture'
import type { CheckOutcome } from './route-availability-types'

function outcome(checks: readonly CheckOutcome[], name: CheckOutcome['check']) {
  return checks.find((check) => check.check === name)
}

const codex = (
  model: string,
  level: 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'max',
  requirement: 'required' | 'if_supported' = 'required'
) => subjectOf('codex_cli', model, level, requirement)

describe('codex model and reasoning checks', () => {
  it('passes a listed model at a level it lists, and passes the effort explicitly', () => {
    const { checks, mapping } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS))
    )
    expect(checks.every((check) => check.result === 'pass')).toBe(true)
    expect(checks.map((check) => check.check)).toEqual([
      'cli',
      'model',
      'reasoning',
      'auth',
      'quota',
      'workspace'
    ])
    expect(mapping).toEqual({
      status: 'resolved',
      effort: 'max',
      delivery: 'codex_config_override',
      resolution: 'applied'
    })
  })

  it('fails a model the account list does not name', () => {
    const { checks, mapping } = checkCodexRoute(
      codex('gpt-6.9-sol'),
      observationsOf(listingOf(CODEX_MODELS))
    )
    expect(outcome(checks, 'model')).toMatchObject({ result: 'fail', reason: 'model_not_listed' })
    expect(outcome(checks, 'reasoning')).toBeUndefined()
    expect(mapping).toBeNull()
  })

  it('never admits a model from an empty or failed listing', () => {
    for (const listing of [listingOf([]), failedListing()]) {
      const { checks } = checkCodexRoute(codex('gpt-6.1-sol'), observationsOf(listing))
      expect(outcome(checks, 'model')).toMatchObject({
        result: 'unobserved',
        reason: 'model_list_unavailable'
      })
    }
  })

  it('excludes a rejected slug even though the account lists it', () => {
    const { checks } = checkCodexRoute(codex('gpt-6-sol'), observationsOf(listingOf(CODEX_MODELS)))
    expect(outcome(checks, 'model')).toMatchObject({ result: 'fail', reason: 'model_excluded' })
  })

  it('excludes a listed id the runner could not pass as a model slug', () => {
    const upper: ListedModel = {
      id: 'GPT-7-Test',
      resolvedModel: null,
      label: 'x',
      efforts: ['max']
    }
    const { checks } = checkCodexRoute(
      codex('GPT-7-Test'),
      observationsOf(listingOf([...CODEX_MODELS, upper]))
    )
    expect(outcome(checks, 'model')).toMatchObject({
      result: 'fail',
      reason: 'model_excluded',
      evidence: { violation: 'runner_slug' }
    })
  })

  it('matches only the listed id: a resolved-model field plays no part for Codex', () => {
    const odd: ListedModel = {
      id: 'gpt-x-1',
      resolvedModel: 'gpt-6.1-sol',
      label: 'x',
      efforts: ['max']
    }
    const { checks } = checkCodexRoute(codex('gpt-6.1-sol'), observationsOf(listingOf([odd])))
    expect(outcome(checks, 'model')).toMatchObject({ result: 'fail', reason: 'model_not_listed' })
  })

  it('needs the level in the model listing as well as in the runner set', () => {
    const limited: ListedModel = {
      id: 'gpt-6-luna',
      resolvedModel: null,
      label: 'x',
      efforts: ['low', 'high']
    }
    const { checks } = checkCodexRoute(
      codex('gpt-6-luna', 'max'),
      observationsOf(listingOf([limited]))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({
      result: 'fail',
      reason: 'reasoning_unsupported'
    })
  })

  it('does not relax an unsupported level for if_supported, because the effort is always explicit', () => {
    const limited: ListedModel = {
      id: 'gpt-6-luna',
      resolvedModel: null,
      label: 'x',
      efforts: ['low']
    }
    const { checks, mapping } = checkCodexRoute(
      codex('gpt-6-luna', 'max', 'if_supported'),
      observationsOf(listingOf([limited]))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({
      result: 'fail',
      reason: 'reasoning_unsupported'
    })
    expect(mapping).toEqual({ status: 'unsupported' })
  })
})

describe('codex workspace check', () => {
  it('passes a folder workspace, where the runner skips codex`s git-repository check (D-027)', () => {
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), { workspaceKind: 'folder' })
    )
    expect(outcome(checks, 'workspace')).toEqual({
      check: 'workspace',
      result: 'pass',
      evidence: { workspaceKind: 'folder', gitRepoCheck: 'skipped' }
    })
  })

  it('makes the floating terminal unavailable, since it has no directory to run in', () => {
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), { workspaceKind: 'floating' })
    )
    expect(outcome(checks, 'workspace')).toEqual({
      check: 'workspace',
      result: 'fail',
      reason: 'workspace_not_git',
      evidence: { workspaceKind: 'floating' }
    })
  })

  it('passes a git worktree', () => {
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), { workspaceKind: 'git-worktree' })
    )
    expect(outcome(checks, 'workspace')).toMatchObject({ result: 'pass' })
  })

  it('makes no workspace claim when the evaluation is not about one workspace', () => {
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), { workspaceKind: null })
    )
    expect(outcome(checks, 'workspace')).toBeUndefined()
  })
})

describe('codex cli check', () => {
  it('fails cli_missing when detection does not report codex', () => {
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), { detection: detectionOf(['claude']) })
    )
    expect(outcome(checks, 'cli')).toMatchObject({ result: 'fail', reason: 'cli_missing' })
  })

  it('fails cli_disabled when the user turned codex off', () => {
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), { detection: detectionOf(undefined, ['codex']) })
    )
    expect(outcome(checks, 'cli')).toMatchObject({ result: 'fail', reason: 'cli_disabled' })
  })

  it.each([
    ['not_found', 'cli_missing'],
    ['invalid_selection', 'cli_not_launchable'],
    ['unexpected', 'cli_not_launchable']
  ] as const)('maps a %s resolution failure to %s', (code, reason) => {
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), { codexExecutable: { ok: false, code } })
    )
    expect(outcome(checks, 'cli')).toMatchObject({ result: 'fail', reason })
  })

  it('reports one cli outcome, taking detection first', () => {
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), {
        detection: detectionOf(['claude']),
        codexExecutable: { ok: false, code: 'invalid_selection' }
      })
    )
    expect(checks.filter((check) => check.check === 'cli')).toHaveLength(1)
    expect(outcome(checks, 'cli')).toMatchObject({ reason: 'cli_missing' })
  })

  it('is unobserved when detection could not be read', () => {
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), { detection: { ok: false } })
    )
    expect(outcome(checks, 'cli')).toMatchObject({ result: 'unobserved', reason: 'cli_unobserved' })
  })
})

describe('codex auth and quota checks', () => {
  it('reads the codex reading, not the claude one', () => {
    const rateLimits = headroomOf({
      codex: limitsOf('codex', {
        status: 'error',
        usageMetadata: { failureKind: 'missing-credentials' }
      })
    })
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), { rateLimits })
    )
    expect(outcome(checks, 'auth')).toMatchObject({ result: 'fail', reason: 'auth_failed' })
  })

  it('fails quota_exhausted for a known exhausted codex window', () => {
    const exhausted = {
      usedPercent: 100,
      windowMinutes: 300,
      resetsAt: NOW_MS + 1_000,
      resetDescription: null
    }
    const rateLimits = headroomOf({ codex: limitsOf('codex', { weekly: exhausted }) })
    const { checks } = checkCodexRoute(
      codex('gpt-6.1-sol'),
      observationsOf(listingOf(CODEX_MODELS), { rateLimits })
    )
    expect(outcome(checks, 'quota')).toMatchObject({ result: 'fail', reason: 'quota_exhausted' })
  })
})

describe('readCodexExecutable', () => {
  const resolved: CodexExecutable = {
    program: 'codex',
    prefixArgs: [],
    entryPath: 'codex',
    requestedPath: 'codex',
    launch: 'direct',
    source: 'path-search',
    electronRunAsNode: false
  }

  it('reports how codex would launch, with no path in the reading', () => {
    expect(readCodexExecutable(() => resolved)).toEqual({
      ok: true,
      launch: 'direct',
      source: 'path-search'
    })
  })

  it('keeps the resolver`s own failure codes', () => {
    for (const code of ['not_found', 'invalid_selection'] as const) {
      expect(
        readCodexExecutable(() => {
          throw new CodexExecutableError(code, 'x')
        })
      ).toEqual({ ok: false, code })
    }
  })

  it('reports any other failure as unexpected', () => {
    expect(
      readCodexExecutable(() => {
        throw new Error('boom')
      })
    ).toEqual({ ok: false, code: 'unexpected' })
  })
})

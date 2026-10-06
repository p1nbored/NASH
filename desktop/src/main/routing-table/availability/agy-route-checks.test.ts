import { describe, expect, it } from 'vitest'
import { checkAgyRoute } from './agy-route-checks'
import type { ListedModel } from './model-listing'
import {
  AGY_MODELS,
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

const agy = (
  model: string,
  level: 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'high',
  requirement: 'required' | 'if_supported' = 'if_supported'
) => subjectOf('agy_cli', model, level, requirement)

const listed = (id: string, label: string): ListedModel => ({
  id,
  resolvedModel: null,
  label,
  efforts: []
})

describe('agy model check', () => {
  it('passes the Gemini 3.8 Flash variant id that `agy models` lists, with no effort flag', () => {
    const { checks, mapping } = checkAgyRoute(
      agy('gemini-3.8-flash-high'),
      observationsOf(listingOf(AGY_MODELS))
    )
    expect(checks.every((check) => check.result === 'pass')).toBe(true)
    expect(mapping).toEqual({
      status: 'resolved',
      effort: null,
      delivery: 'agy_model_id_variant',
      resolution: 'encoded_in_model_id'
    })
  })

  it('fails the bare gemini-3.8-flash id, which the listing does not carry', () => {
    const { checks } = checkAgyRoute(agy('gemini-3.8-flash'), observationsOf(listingOf(AGY_MODELS)))
    expect(outcome(checks, 'model')).toMatchObject({ result: 'fail', reason: 'model_not_listed' })
  })

  it('never admits a model from an empty or failed listing', () => {
    for (const listing of [listingOf([]), failedListing()]) {
      const { checks } = checkAgyRoute(agy('gemini-3.8-flash-high'), observationsOf(listing))
      expect(outcome(checks, 'model')).toMatchObject({
        result: 'unobserved',
        reason: 'model_list_unavailable'
      })
    }
  })

  it('excludes a Gemini 4 id before looking at the listing', () => {
    const { checks } = checkAgyRoute(
      agy('gemini-4-flash-high'),
      observationsOf(
        listingOf([...AGY_MODELS, listed('gemini-4-flash-high', 'Gemini 4 Flash (High)')])
      )
    )
    expect(outcome(checks, 'model')).toMatchObject({ result: 'fail', reason: 'model_excluded' })
  })

  it('excludes a listed model whose label names Gemini 4, although its id does not', () => {
    const sneaky = listed('experimental-flash-high', 'Gemini 4 Experimental (High)')
    const { checks } = checkAgyRoute(
      agy('experimental-flash-high'),
      observationsOf(listingOf([...AGY_MODELS, sneaky]))
    )
    expect(outcome(checks, 'model')).toMatchObject({
      result: 'fail',
      reason: 'model_excluded',
      evidence: { violation: 'label' }
    })
  })

  it('is not affected by another row that names Gemini 4', () => {
    const other = listed('gemini-4-flash-high', 'Gemini 4 Flash (High)')
    const { checks } = checkAgyRoute(
      agy('gemini-3.8-flash-high'),
      observationsOf(listingOf([...AGY_MODELS, other]))
    )
    expect(outcome(checks, 'model')).toMatchObject({ result: 'pass' })
  })
})

describe('agy reasoning check', () => {
  it('has no max: a required max is unsupported', () => {
    const { checks } = checkAgyRoute(
      agy('gemini-3.8-flash-high', 'max', 'required'),
      observationsOf(listingOf(AGY_MODELS))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({
      result: 'fail',
      reason: 'reasoning_unsupported'
    })
  })

  it('records an if_supported max as not applied, and sends no thinking parameter', () => {
    const { checks, mapping } = checkAgyRoute(
      agy('gemini-3.8-flash-high', 'max', 'if_supported'),
      observationsOf(listingOf(AGY_MODELS))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({
      result: 'pass',
      evidence: { resolution: 'omitted_unsupported' }
    })
    expect(mapping).toMatchObject({ effort: null, resolution: 'omitted_unsupported' })
  })

  it('refuses a required level the pinned variant does not encode, never swapping the sibling variant', () => {
    const { checks } = checkAgyRoute(
      agy('gemini-3.8-flash-low', 'high', 'required'),
      observationsOf(listingOf(AGY_MODELS))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({
      result: 'fail',
      reason: 'reasoning_unsupported'
    })
  })

  it('is unverified for a listed bare id, because how --effort combines with it is not proven', () => {
    const bare = listed('gemini-9-flash', 'Gemini 9 Flash')
    const { checks } = checkAgyRoute(
      agy('gemini-9-flash', 'high', 'required'),
      observationsOf(listingOf([...AGY_MODELS, bare]))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({
      result: 'unobserved',
      reason: 'reasoning_unverified'
    })
  })
})

describe('agy cli, auth and quota checks', () => {
  it('detects agy as antigravity', () => {
    const { checks } = checkAgyRoute(
      agy('gemini-3.8-flash-high'),
      observationsOf(listingOf(AGY_MODELS), { detection: detectionOf(['claude', 'codex']) })
    )
    expect(outcome(checks, 'cli')).toMatchObject({ result: 'fail', reason: 'cli_missing' })
  })

  it('maps a signed-out agy reading to auth_failed', () => {
    const rateLimits = headroomOf({
      antigravity: limitsOf('antigravity', {
        status: 'error',
        usageMetadata: { failureKind: 'missing-credentials' }
      })
    })
    const { checks } = checkAgyRoute(
      agy('gemini-3.8-flash-high'),
      observationsOf(listingOf(AGY_MODELS), { rateLimits })
    )
    expect(outcome(checks, 'auth')).toMatchObject({ result: 'fail', reason: 'auth_failed' })
  })

  it('fails quota_exhausted for a known exhausted agy window', () => {
    const exhausted = {
      usedPercent: 100,
      windowMinutes: 300,
      resetsAt: NOW_MS + 1_000,
      resetDescription: null
    }
    const rateLimits = headroomOf({ antigravity: limitsOf('antigravity', { session: exhausted }) })
    const { checks } = checkAgyRoute(
      agy('gemini-3.8-flash-high'),
      observationsOf(listingOf(AGY_MODELS), { rateLimits })
    )
    expect(outcome(checks, 'quota')).toMatchObject({ result: 'fail', reason: 'quota_exhausted' })
  })

  it('makes no workspace claim', () => {
    const { checks } = checkAgyRoute(
      agy('gemini-3.8-flash-high'),
      observationsOf(listingOf(AGY_MODELS), { workspaceKind: 'folder' })
    )
    expect(outcome(checks, 'workspace')).toBeUndefined()
  })
})

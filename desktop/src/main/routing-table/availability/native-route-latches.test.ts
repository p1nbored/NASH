import { describe, expect, it } from 'vitest'
import type { DiscoverCommitMessageModelsResult } from '../../text-generation/source-control-text-generation-types'
import type { ModelListing } from './model-listing'
import { nativeRouteModelListing } from './native-route-models'
import { createEvaluatorHarness } from './route-availability-harness.test-fixture'
import { NOW_MS, subjectOf } from './route-availability.test-fixture'

const model = 'openai/gpt-6.1-sol'
const omp = subjectOf('omp_cli', model, 'none')
const discovery: DiscoverCommitMessageModelsResult = {
  success: true,
  catalogOrigin: 'probe',
  capability: {
    id: 'omp',
    label: 'OMP',
    modelSource: 'dynamic',
    models: [],
    defaultModelId: ''
  },
  models: [{ id: model, label: model }],
  defaultModelId: model
}

function dynamicHarness(listing: () => ModelListing) {
  return createEvaluatorHarness({
    detected: async () => ['omp'],
    models: { omp: async () => listing() },
    readRateLimits: () => null
  })
}

describe('native route failure latches', () => {
  it('clears auth and quota only after a newer CLI response on explicit recheck', async () => {
    let answeredAt = NOW_MS
    const h = dynamicHarness(() => nativeRouteModelListing('omp', discovery, answeredAt))
    h.evaluator.latch(omp, 'auth')
    h.evaluator.latch(omp, 'quota')
    answeredAt += 1
    h.clock.nowMs = answeredAt

    for (const freshness of ['dispatch', 'cached'] as const) {
      const [result] = await h.evaluator.evaluate([omp], { freshness })
      expect(result).toMatchObject({
        status: 'unavailable',
        reasons: expect.arrayContaining(['auth_failed', 'quota_exhausted'])
      })
    }
    const [rechecked] = await h.evaluator.evaluate([omp], { freshness: 'recheck' })
    expect(rechecked).toMatchObject({ status: 'available', reasons: [] })
    const [cached] = await h.evaluator.evaluate([omp], { freshness: 'cached' })
    expect(cached).toMatchObject({ status: 'available', reasons: [] })
  })

  it.each([NOW_MS - 1, NOW_MS])(
    'keeps failures when the CLI response is not newer (%s)',
    async (answeredAt) => {
      const h = dynamicHarness(() => nativeRouteModelListing('omp', discovery, answeredAt))
      h.evaluator.latch(omp, 'auth')
      h.evaluator.latch(omp, 'quota')
      h.clock.nowMs += 1
      const [result] = await h.evaluator.evaluate([omp], { freshness: 'recheck' })
      expect(result).toMatchObject({
        status: 'unavailable',
        reasons: expect.arrayContaining(['auth_failed', 'quota_exhausted'])
      })
    }
  )

  it('keeps failures when the recheck probe fails', async () => {
    const h = dynamicHarness(() =>
      nativeRouteModelListing('omp', { success: false, error: 'offline' }, NOW_MS + 1)
    )
    h.evaluator.latch(omp, 'auth')
    h.evaluator.latch(omp, 'quota')
    h.clock.nowMs += 1
    const [result] = await h.evaluator.evaluate([omp], { freshness: 'recheck' })
    expect(result).toMatchObject({
      status: 'unavailable',
      reasons: expect.arrayContaining(['auth_failed', 'quota_exhausted'])
    })
  })

  it('does not infer a new provider probe from an unmarked listing', async () => {
    const h = dynamicHarness(() => ({
      ok: true,
      models: [{ id: model, label: model, resolvedModel: null, efforts: [] }],
      observedAtMs: NOW_MS + 1
    }))
    h.evaluator.latch(omp, 'auth')
    h.evaluator.latch(omp, 'quota')
    h.clock.nowMs += 1
    const [result] = await h.evaluator.evaluate([omp], { freshness: 'recheck' })
    expect(result).toMatchObject({
      status: 'unavailable',
      reasons: expect.arrayContaining(['auth_failed', 'quota_exhausted'])
    })
  })

  it('does not treat a refreshed static catalog or explicit-model catalog as a CLI response', async () => {
    for (const [agent, target, modelId, effort] of [
      ['gemini', 'gemini_cli', 'gemini-4-argon', 'none'],
      ['muse', 'muse_cli', 'channel/model-v2', 'ultra']
    ] as const) {
      let readAt = NOW_MS
      const route = subjectOf(target, modelId, effort)
      const h = createEvaluatorHarness({
        detected: async () => [agent],
        models: { [agent]: async () => nativeRouteModelListing(agent, null, readAt) },
        readRateLimits: () => null
      })
      h.evaluator.latch(route, 'auth')
      h.evaluator.latch(route, 'quota')
      readAt += 1
      h.clock.nowMs = readAt
      const [result] = await h.evaluator.evaluate([route], { freshness: 'recheck' })
      expect(result).toMatchObject({
        status: 'unavailable',
        reasons: expect.arrayContaining(['auth_failed', 'quota_exhausted'])
      })
    }
  })
})

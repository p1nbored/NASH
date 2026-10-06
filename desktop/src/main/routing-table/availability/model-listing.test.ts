import { describe, expect, it } from 'vitest'
import type { AgentSessionModelOption } from '../../../shared/agent-session-wire'
import type { DiscoverCommitMessageModelsResult } from '../../text-generation/source-control-text-generation-types'
import {
  listingFromCatalogSuccess,
  listingFromDiscovery,
  modelListingPortFromDiscovery,
  modelListingPortFromProbe
} from './model-listing'

const AT = 1_700_000_000_000

function option(id: string, efforts: string[], label = id): AgentSessionModelOption {
  return {
    id,
    label,
    isDefault: false,
    efforts: efforts.map((value) => ({ value, label: value }))
  }
}

describe('listingFromCatalogSuccess', () => {
  it('keeps ids, labels and effort values, and attaches the resolved ids from the side map', () => {
    const listing = listingFromCatalogSuccess(
      {
        models: [option('opus', ['low', 'max'], 'Opus 5.5'), option('haiku', [])],
        resolvedModelByModel: new Map([['opus', 'claude-opus-5-5']])
      },
      AT
    )
    expect(listing).toEqual({
      ok: true,
      observedAtMs: AT,
      models: [
        {
          id: 'opus',
          resolvedModel: 'claude-opus-5-5',
          label: 'Opus 5.5',
          efforts: ['low', 'max']
        },
        { id: 'haiku', resolvedModel: null, label: 'haiku', efforts: [] }
      ]
    })
  })

  it('works without a resolved-id map, as for Codex', () => {
    const listing = listingFromCatalogSuccess({ models: [option('gpt-6.1-sol', ['max'])] }, AT)
    expect(listing).toMatchObject({
      ok: true,
      models: [{ id: 'gpt-6.1-sol', resolvedModel: null }]
    })
  })

  it('treats a listing of no models as no listing', () => {
    expect(listingFromCatalogSuccess({ models: [] }, AT)).toEqual({ ok: false, observedAtMs: AT })
  })
})

describe('listingFromDiscovery', () => {
  function discovered(
    overrides: Partial<Extract<DiscoverCommitMessageModelsResult, { success: true }>> = {}
  ): DiscoverCommitMessageModelsResult {
    return {
      success: true,
      capability: {
        id: 'antigravity',
        label: 'Antigravity',
        modelSource: 'dynamic',
        defaultModelId: 'default',
        models: []
      },
      models: [
        { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
        { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' }
      ],
      defaultModelId: 'default',
      catalogOrigin: 'probe',
      ...overrides
    }
  }

  it('reads the ids and labels `agy models` printed, with no effort list', () => {
    expect(listingFromDiscovery(discovered(), AT)).toEqual({
      ok: true,
      observedAtMs: AT,
      models: [
        {
          id: 'gemini-3.8-flash-high',
          resolvedModel: null,
          label: 'Gemini 3.8 Flash (High)',
          efforts: []
        },
        {
          id: 'gemini-3.8-flash-low',
          resolvedModel: null,
          label: 'Gemini 3.8 Flash (Low)',
          efforts: []
        }
      ]
    })
  })

  it('refuses the static fallback list, which is not what the CLI printed', () => {
    expect(listingFromDiscovery(discovered({ catalogOrigin: 'spec' }), AT)).toEqual({
      ok: false,
      observedAtMs: AT
    })
  })

  it('refuses a failed discovery and an empty one', () => {
    expect(listingFromDiscovery({ success: false, error: 'failed' }, AT)).toEqual({
      ok: false,
      observedAtMs: AT
    })
    expect(listingFromDiscovery(discovered({ models: [] }), AT)).toEqual({
      ok: false,
      observedAtMs: AT
    })
  })
})

describe('listing ports', () => {
  it('resolves the account home, runs the probe and stamps the time it finished', async () => {
    let now = AT
    const homes: string[] = []
    const port = modelListingPortFromProbe({
      resolveAccountHome: async () => 'home-a',
      probe: async (home) => {
        homes.push(home)
        now += 5
        return { models: [option('gpt-6.1-sol', ['max'])] }
      },
      now: () => now
    })
    expect(await port()).toMatchObject({ ok: true, observedAtMs: AT + 5 })
    expect(homes).toEqual(['home-a'])
  })

  it('reports a probe that throws, or an account home that cannot be resolved, as no listing', async () => {
    const failing = modelListingPortFromProbe({
      resolveAccountHome: async () => 'home-a',
      probe: async () => {
        throw new Error('probe failed with a token')
      },
      now: () => AT
    })
    expect(await failing()).toEqual({ ok: false, observedAtMs: AT })
    const noHome = modelListingPortFromProbe({
      resolveAccountHome: async () => {
        throw new Error('no home')
      },
      probe: async () => ({ models: [option('x', [])] }),
      now: () => AT
    })
    expect(await noHome()).toEqual({ ok: false, observedAtMs: AT })
  })

  it('wraps a discovery the same way and never rejects', async () => {
    const port = modelListingPortFromDiscovery({
      discover: async () => {
        throw new Error('spawn failed')
      },
      now: () => AT
    })
    expect(await port()).toEqual({ ok: false, observedAtMs: AT })
  })
})

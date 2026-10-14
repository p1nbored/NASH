import { describe, expect, it } from 'vitest'
import { checkNativeRoute } from './native-route-checks'
import { nativeRouteModelListing } from './native-route-models'
import {
  detectionOf,
  observationsOf,
  subjectOf,
  NOW_MS,
  limitsOf
} from './route-availability.test-fixture'

describe('native CLI routing', () => {
  it('offers Argon through Gemini without inventing a CLI effort flag', () => {
    const listing = nativeRouteModelListing('gemini', null, NOW_MS)
    expect(listing).toMatchObject({
      ok: true,
      models: expect.arrayContaining([
        { id: 'gemini-4-argon', label: 'Gemini 4 Argon', resolvedModel: null, efforts: [] }
      ])
    })
    const observed = observationsOf(listing, { detection: detectionOf(['gemini']) })
    const result = checkNativeRoute(
      'gemini',
      subjectOf('gemini_cli', 'gemini-4-argon', 'none'),
      observed
    )
    expect(result.checks.every((check) => check.result === 'pass')).toBe(true)
    expect(result.mapping).toMatchObject({ status: 'resolved', effort: null })
    expect(
      checkNativeRoute('gemini', subjectOf('gemini_cli', 'gemini-4-argon', 'high'), observed)
        .mapping
    ).toEqual({ status: 'unsupported' })
  })

  it('uses an explicit Muse model and the native effort adapter', () => {
    const listing = nativeRouteModelListing('muse', null, NOW_MS)
    const result = checkNativeRoute(
      'muse',
      subjectOf('muse_cli', 'channel/model-v2', 'ultra'),
      observationsOf(listing, { detection: detectionOf(['muse']) })
    )
    expect(result.checks.every((check) => check.result === 'pass')).toBe(true)
    expect(result.mapping).toMatchObject({
      status: 'resolved',
      effort: 'ultra',
      delivery: 'native_session_option'
    })
  })

  it('keeps dynamic catalogs authoritative and rejects unsupported effort', () => {
    expect(
      nativeRouteModelListing('grok', { success: false, error: 'offline' }, NOW_MS)
    ).toMatchObject({ ok: false })
    const listing = nativeRouteModelListing(
      'grok',
      {
        success: true,
        catalogOrigin: 'probe',
        capability: {
          id: 'grok',
          label: 'Grok',
          modelSource: 'dynamic',
          models: [],
          defaultModelId: 'grok-4.7'
        },
        models: [{ id: 'grok-4.7', label: 'Grok 4.7' }],
        defaultModelId: 'grok-4.7'
      },
      NOW_MS
    )
    const observations = observationsOf(listing, { detection: detectionOf(['grok']) })
    expect(
      checkNativeRoute('grok', subjectOf('grok_cli', 'grok-4.7', 'xhigh'), observations).mapping
    ).toMatchObject({ status: 'resolved', effort: 'xhigh' })
    expect(
      checkNativeRoute('grok', subjectOf('grok_cli', 'grok-4.7', 'ultra'), observations).mapping
    ).toEqual({ status: 'unsupported' })
    expect(
      checkNativeRoute('grok', subjectOf('grok_cli', 'not-listed', 'high'), observations).checks
    ).toContainEqual({ check: 'model', result: 'fail', reason: 'model_not_listed' })
  })

  it('still blocks missing/disabled CLIs and known authentication failures', () => {
    const listing = nativeRouteModelListing('gemini', null, NOW_MS)
    const subject = subjectOf('gemini_cli', 'gemini-4-argon', 'none')
    const missing = checkNativeRoute('gemini', subject, observationsOf(listing))
    expect(missing.checks).toContainEqual(expect.objectContaining({ reason: 'cli_missing' }))
    const badAuth = checkNativeRoute(
      'gemini',
      subject,
      observationsOf(listing, {
        detection: detectionOf(['gemini']),
        rateLimits: {
          claude: null,
          codex: null,
          antigravity: null,
          gemini: limitsOf('gemini', {
            status: 'error',
            usageMetadata: { failureKind: 'missing-credentials' }
          })
        }
      })
    )
    expect(badAuth.checks).toContainEqual(expect.objectContaining({ reason: 'auth_failed' }))
  })
})

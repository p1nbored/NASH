import { describe, expect, it, vi } from 'vitest'
import { FIXTURE_UPDATE_FEED, withFixtureUpdateFeed } from './app-update-feed.test-fixture'

describe('NASH release feed', () => {
  it('is disabled by default: there is no feed and requiring one throws', async () => {
    const { getAppUpdateFeed, requireAppUpdateFeed, UpdateFeedDisabledError } =
      await import('./app-update-feed.js')

    expect(getAppUpdateFeed()).toBeNull()
    expect(() => requireAppUpdateFeed()).toThrow(UpdateFeedDisabledError)
    expect(() => requireAppUpdateFeed()).toThrow(/no release feed/i)
  })

  it('names no Orca owner, repository or website', async () => {
    const { getAppUpdateFeed } = await import('./app-update-feed.js')

    const serialized = JSON.stringify(getAppUpdateFeed())

    expect(serialized).not.toMatch(/stablyai|onorca|orca/i)
  })

  describe('with a configured feed', () => {
    it('returns exactly the configured feed and derives the repository slugs from it', async () => {
      vi.resetModules()
      vi.doMock('./app-identity-constants', async (importOriginal) =>
        withFixtureUpdateFeed(await importOriginal())
      )
      const { getAppUpdateFeed, requireAppUpdateFeed, getUpdateFeedRepoSlug } =
        await import('./app-update-feed.js')

      expect(getAppUpdateFeed()).toBe(FIXTURE_UPDATE_FEED)
      expect(requireAppUpdateFeed()).toBe(FIXTURE_UPDATE_FEED)
      expect(getUpdateFeedRepoSlug(FIXTURE_UPDATE_FEED)).toBe('fixture-owner/fixture-app')
      expect(getUpdateFeedRepoSlug(FIXTURE_UPDATE_FEED, 'hourly')).toBe(
        'fixture-owner/fixture-app-hourly'
      )
      vi.doUnmock('./app-identity-constants')
      vi.resetModules()
    })
  })
})

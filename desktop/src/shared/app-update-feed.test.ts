import { describe, expect, it, vi } from 'vitest'
import { FIXTURE_UPDATE_FEED, withFixtureUpdateFeed } from './app-update-feed.test-fixture'

describe('NASH release feed', () => {
  it('routes the shipped updater to NASH without an upstream whats-new service', async () => {
    const { getAppUpdateFeed, requireAppUpdateFeed } = await import('./app-update-feed.js')

    expect(getAppUpdateFeed()).toEqual({
      owner: 'p1nbored',
      repo: 'NASH',
      whatsNew: null,
      devChannels: false
    })
    expect(requireAppUpdateFeed()).toBe(getAppUpdateFeed())
  })

  it('names no Orca owner, repository or website', async () => {
    const { getAppUpdateFeed } = await import('./app-update-feed.js')

    const serialized = JSON.stringify(getAppUpdateFeed())

    expect(serialized).not.toMatch(/stablyai|onorca|orca/i)
  })

  it('supports stable and RC only and never invents NASH development repositories', async () => {
    const { getReleaseRepoForChannel, isChannelSupportedOnPlatform } =
      await import('./release-channel.js')
    for (const channel of ['stable', 'rc', 'hourly', 'daily', 'adhoc'] as const) {
      expect(getReleaseRepoForChannel(channel)).toBe('p1nbored/NASH')
      for (const platform of ['win32', 'darwin', 'linux'] as const) {
        expect(isChannelSupportedOnPlatform(channel, platform)).toBe(
          channel === 'stable' || channel === 'rc'
        )
      }
    }
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

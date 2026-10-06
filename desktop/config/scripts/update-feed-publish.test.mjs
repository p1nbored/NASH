import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { resolveBuilderPublishConfig } = require('./update-feed-publish.cjs')

// FIXTURE_ONLY: a stand-in release feed; the shipped identity has none.
const FIXTURE_FEED = { owner: 'fixture-owner', repo: 'fixture-app', whatsNew: null }

describe('electron-builder publish config', () => {
  it('publishes nothing when the identity has no release feed', () => {
    expect(resolveBuilderPublishConfig(null, null)).toBeNull()
    expect(resolveBuilderPublishConfig(null, 'hourly')).toBeNull()
    expect(resolveBuilderPublishConfig(undefined, null)).toBeNull()
  })

  it('publishes releases as drafts to the main repository of a configured feed', () => {
    expect(resolveBuilderPublishConfig(FIXTURE_FEED, null)).toEqual({
      provider: 'github',
      owner: 'fixture-owner',
      repo: 'fixture-app',
      releaseType: 'draft'
    })
  })

  it.each(['hourly', 'daily', 'adhoc'])(
    'publishes %s builds as prereleases to their own repository',
    (channel) => {
      expect(resolveBuilderPublishConfig(FIXTURE_FEED, channel)).toEqual({
        provider: 'github',
        owner: 'fixture-owner',
        repo: `fixture-app-${channel}`,
        releaseType: 'prerelease'
      })
    }
  )

  it('keeps the dev channels on separate repositories', () => {
    const repos = ['hourly', 'daily', 'adhoc'].map(
      (channel) => resolveBuilderPublishConfig(FIXTURE_FEED, channel).repo
    )

    expect(new Set([...repos, FIXTURE_FEED.repo]).size).toBe(4)
  })
})

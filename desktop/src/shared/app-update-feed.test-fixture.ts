import type { AppUpdateFeed } from './app-update-feed'

// FIXTURE_ONLY: a stand-in NASH release feed for tests that exercise the updater with a feed present.
// The `.invalid` host never resolves, and no real owner or repository is named.
export const FIXTURE_UPDATE_FEED: AppUpdateFeed = {
  owner: 'fixture-owner',
  repo: 'fixture-app',
  whatsNew: {
    changelogJsonUrl: 'https://updates.fixture.invalid/whats-new/changelog.json',
    changelogPageUrl: 'https://updates.fixture.invalid/changelog',
    nudgeJsonUrl: 'https://updates.fixture.invalid/whats-new/nudge.json'
  }
}

// Why a factory: vi.mock replaces the identity module for one test file, and every other value must stay real.
export function withFixtureUpdateFeed<T extends { APP_IDENTITY: object }>(
  actual: T
): T & { APP_IDENTITY: T['APP_IDENTITY'] & { updateFeed: AppUpdateFeed } } {
  return { ...actual, APP_IDENTITY: { ...actual.APP_IDENTITY, updateFeed: FIXTURE_UPDATE_FEED } }
}

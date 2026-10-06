import { APP_IDENTITY } from './app-identity-constants'

// Where a NASH build looks for releases. The feed is part of the app identity (decision D-017): a null
// feed means updates are disabled, so no check, download, release listing or what's-new fetch can
// dial a host, and a build can never pull releases from a real Orca install's feed.
export type AppUpdateWhatsNewFeed = {
  readonly changelogJsonUrl: string
  readonly changelogPageUrl: string
  readonly nudgeJsonUrl: string
}

export type AppUpdateFeed = {
  readonly owner: string
  readonly repo: string
  // null: the release feed exists but no what's-new service does, so changelog and nudge fetches are skipped.
  readonly whatsNew: AppUpdateWhatsNewFeed | null
}

export class UpdateFeedDisabledError extends Error {
  constructor() {
    super('Updates are disabled: this build has no release feed.')
    this.name = 'UpdateFeedDisabledError'
  }
}

export function getAppUpdateFeed(): AppUpdateFeed | null {
  return APP_IDENTITY.updateFeed
}

export function requireAppUpdateFeed(): AppUpdateFeed {
  const feed = getAppUpdateFeed()
  if (feed === null) {
    throw new UpdateFeedDisabledError()
  }
  return feed
}

/** `owner/repo` of the main release repository, or of a dev-channel repository named `<repo>-<suffix>`. */
export function getUpdateFeedRepoSlug(feed: AppUpdateFeed, devChannelSuffix?: string): string {
  return `${feed.owner}/${devChannelSuffix ? `${feed.repo}-${devChannelSuffix}` : feed.repo}`
}

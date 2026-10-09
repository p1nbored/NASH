// Builds electron-builder's `publish` setting from the app identity's release feed (decision D-017).
// A null feed means NASH has no release repository of its own, so nothing is published and no
// app-update.yml is written; the build can never publish to, or update from, a real Orca install's repos.

/**
 * @param {{ owner: string, repo: string, devChannels?: boolean } | null | undefined} updateFeed `updateFeed` from app-identity-constants.json
 * @param {'hourly' | 'daily' | 'adhoc' | null} devChannel the dev channel being built, or null for a release build
 */
function resolveBuilderPublishConfig(updateFeed, devChannel) {
  if (!updateFeed) {
    // Why null and not undefined: electron-builder auto-detects a GitHub feed from the repository when publish is unset.
    return null
  }
  return {
    provider: 'github',
    owner: updateFeed.owner,
    // Why each dev channel has its own repo: the main repo's releases atom feed exposes only its 10 newest
    // entries, so 24 hourly tags a day there would evict every stable/RC entry and strand real users.
    repo:
      devChannel && updateFeed.devChannels !== false
        ? `${updateFeed.repo}-${devChannel}`
        : updateFeed.repo,
    // Why draft on the main repo: `--publish always` otherwise creates a public GitHub release as soon
    // as the first platform uploads, and /releases/latest serves a missing Windows exe. release-cut
    // undrafts only after every required asset exists.
    releaseType: devChannel ? 'prerelease' : 'draft'
  }
}

module.exports = { resolveBuilderPublishConfig }

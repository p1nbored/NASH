import { getAppUpdateFeed } from '../../../shared/app-update-feed'
import { getReleaseNotesUrlForVersion } from '../../../shared/release-channel'

/** False when this build has no release feed (decision D-017): nothing checks, downloads or links release notes. */
export function isUpdateFeedAvailable(): boolean {
  return getAppUpdateFeed() !== null
}

/** Release-notes page for a version, or undefined when the build has none, so no caller renders an empty link. */
export function releaseNotesUrlFor(version: string | null): string | undefined {
  return getReleaseNotesUrlForVersion(version) || undefined
}

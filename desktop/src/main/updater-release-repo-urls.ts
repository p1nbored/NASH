import { getUpdateFeedRepoSlug, requireAppUpdateFeed } from '../shared/app-update-feed'

// Why every address is built per call from the configured feed: with no feed these throw, so no
// check can reach a host, and none can reach a real Orca install's releases (decision D-017).
export function getReleaseRepoUrl(): string {
  return `https://github.com/${getUpdateFeedRepoSlug(requireAppUpdateFeed())}`
}

export function getReleasesAtomUrl(): string {
  return `${getReleaseRepoUrl()}/releases.atom`
}

export function getReleasesDownloadBase(): string {
  return `${getReleaseRepoUrl()}/releases/download`
}

export function getLatestReleaseDownloadUrl(): string {
  return `${getReleaseRepoUrl()}/releases/latest/download`
}

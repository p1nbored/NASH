import { APP_IDENTITY } from './app-identity-constants'

// Issue and source links trace to NASH's own repository (D-036); the update feed stays separate (D-026).

/** https://github.com/<owner>/<repo> of the NASH release repository. */
export function getReleaseRepositoryUrl(): string {
  const { owner, repo } = APP_IDENTITY.releaseRepository
  return `https://github.com/${owner}/${repo}`
}

/** The page that opens a new issue in the NASH release repository. */
export function getNewIssueUrl(): string {
  return `${getReleaseRepositoryUrl()}/issues/new`
}

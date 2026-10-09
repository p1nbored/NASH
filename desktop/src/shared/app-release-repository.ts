import { APP_IDENTITY } from './app-identity-constants'

// Issue and source links trace to NASH's own repository (D-036); the update feed stays separate (D-026).

/** https://github.com/<owner>/<repo> of the NASH release repository. */
export function getReleaseRepositoryUrl(): string {
  const { owner, repo } = APP_IDENTITY.releaseRepository
  return `https://github.com/${owner}/${repo}`
}

/** The page that opens a new issue in the NASH release repository. */
export function getNewIssueUrl(title?: string, body?: string): string {
  const url = new URL(`${getReleaseRepositoryUrl()}/issues/new`)
  if (title) {
    url.searchParams.set('title', title.slice(0, 160))
  }
  if (body) {
    let preview = body.slice(0, 6000)
    const setBody = () =>
      url.searchParams.set(
        'body',
        preview +
          (preview.length < body.length
            ? '\n\n[Report shortened for GitHub. Copy the full details from NASH if needed.]'
            : '')
      )
    setBody()
    // GitHub issue links have a URL-length limit, including percent-encoded Unicode.
    while (url.href.length > 7500) {
      preview = preview.slice(0, -250)
      setBody()
    }
  }
  return url.href
}

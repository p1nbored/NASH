import { describe, expect, it } from 'vitest'
import { getNewIssueUrl, getReleaseRepositoryUrl } from './app-release-repository'

it('prefills a NASH issue without allowing report text to change the destination', () => {
  const url = new URL(getNewIssueUrl('Crash & notes', '你好\n# details & labels=other'))
  expect(url.origin + url.pathname).toBe('https://github.com/p1nbored/NASH/issues/new')
  expect(url.searchParams.get('title')).toBe('Crash & notes')
  expect(url.searchParams.get('body')).toBe('你好\n# details & labels=other')
  expect(url.searchParams.has('labels')).toBe(false)
})

it('keeps a large Unicode report within the issue URL limit', () => {
  const url = new URL(getNewIssueUrl('Crash', '错误🙂'.repeat(5000)))
  expect(url.href.length).toBeLessThanOrEqual(7500)
  expect(url.searchParams.get('body')).toContain('[Report shortened')
})

describe('NASH release repository links', () => {
  it('points the source link at the NASH repository', () => {
    expect(getReleaseRepositoryUrl()).toBe('https://github.com/p1nbored/NASH')
  })

  it('opens a new issue in the NASH repository', () => {
    expect(getNewIssueUrl()).toBe('https://github.com/p1nbored/NASH/issues/new')
  })
})

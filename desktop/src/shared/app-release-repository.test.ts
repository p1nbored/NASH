import { describe, expect, it } from 'vitest'
import { getNewIssueUrl, getReleaseRepositoryUrl } from './app-release-repository'

describe('NASH release repository links', () => {
  it('points the source link at the NASH repository', () => {
    expect(getReleaseRepositoryUrl()).toBe('https://github.com/p1nbored/NASH')
  })

  it('opens a new issue in the NASH repository', () => {
    expect(getNewIssueUrl()).toBe('https://github.com/p1nbored/NASH/issues/new')
  })
})

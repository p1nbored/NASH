import { describe, expect, it } from 'vitest'
import {
  getReleaseNotesUrlForVersion,
  getReleaseRepoForChannel,
  RELEASE_CHANNELS
} from './release-channel'

// D-017: with no NASH release feed, no channel resolves to a repository and no release-notes link
// can point at a real Orca install's releases.
describe('release channels with no release feed', () => {
  it.each(RELEASE_CHANNELS)('has no repository for the %s channel', (channel) => {
    expect(() => getReleaseRepoForChannel(channel)).toThrow(/no release feed/i)
  })

  it.each([null, '1.4.160', '1.4.160-rc.3', '1.4.160-hourly.202607281400'])(
    'links no release notes for version %s',
    (version) => {
      expect(getReleaseNotesUrlForVersion(version)).toBe('')
    }
  )
})

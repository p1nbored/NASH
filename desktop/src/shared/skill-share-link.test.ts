import { describe, expect, it } from 'vitest'
import { parseSkillShareId, skillShareIdFromArguments } from './skill-share-link'

// D-017: the OS routes orca:// links to a real Orca install, so NASH answers only its own scheme.
describe('skill share links', () => {
  it('accepts a link in the NASH scheme', () => {
    expect(parseSkillShareId('nash://skills/share/share_123')).toBe('share_123')
    expect(parseSkillShareId('nash://skills/share/share_123/')).toBe('share_123')
  })

  it('refuses a link in the Orca scheme', () => {
    expect(parseSkillShareId('orca://skills/share/share_123')).toBeNull()
    expect(parseSkillShareId('ORCA://skills/share/share_123')).toBeNull()
  })

  it('refuses lookalike NASH routes', () => {
    expect(parseSkillShareId('nash://skills/share/share_123/more')).toBeNull()
    expect(parseSkillShareId('nash://other/share/share_123')).toBeNull()
  })

  it('takes a NASH link from launch arguments and ignores an Orca one', () => {
    expect(skillShareIdFromArguments(['nash', 'nash://skills/share/share_second'])).toBe(
      'share_second'
    )
    expect(skillShareIdFromArguments(['nash', 'orca://skills/share/share_second'])).toBeNull()
  })
})

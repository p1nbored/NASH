import { describe, expect, it } from 'vitest'
import { APP_IDENTITY } from '../../../../shared/app-identity-constants'
import { parseSkillShareId } from './skill-share-link'

describe('parseSkillShareId', () => {
  it("accepts Orca Cloud share links, the app's own scheme and bare identifiers", () => {
    expect(parseSkillShareId('share_123')).toBe('share_123')
    expect(parseSkillShareId('https://app.orca.dev/skills/share/share_123')).toBe('share_123')
    expect(parseSkillShareId('https://share.onorca.dev/skills/share/share_123/')).toBe('share_123')
    expect(parseSkillShareId(`${APP_IDENTITY.urlScheme}://skills/share/share_123`)).toBe(
      'share_123'
    )
  })

  it('rejects the orca:// scheme, which the OS routes to a real Orca install (D-017)', () => {
    expect(APP_IDENTITY.urlScheme).toBe('nash')
    expect(parseSkillShareId('orca://skills/share/share_123')).toBeNull()
  })

  it('rejects attacker origins and lookalike paths', () => {
    expect(parseSkillShareId('https://attacker.test/skills/share/share_123')).toBeNull()
    expect(parseSkillShareId('https://app.orca.dev/skills/share/share_123/more')).toBeNull()
    expect(parseSkillShareId('javascript:share_123')).toBeNull()
  })
})

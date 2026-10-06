import { describe, expect, it } from 'vitest'
import { CLEF_CREDENTIAL_REFUSAL_CODES } from '../../../../shared/clef/clef-credential-contract'
import { clefRefusalMessage } from './clef-credential-messages'

describe('clefRefusalMessage', () => {
  it('gives every refusal code its own plain-English sentence', () => {
    const messages = CLEF_CREDENTIAL_REFUSAL_CODES.map((code) => clefRefusalMessage(code))

    expect(new Set(messages).size).toBe(CLEF_CREDENTIAL_REFUSAL_CODES.length)
    for (const message of messages) {
      expect(message).toMatch(/^[A-Z].*\.$/)
      expect(message).not.toMatch(/[_{}]/)
    }
  })

  it('says plainly when sealing stopped the token from being saved', () => {
    expect(clefRefusalMessage('sealing_unavailable')).toBe(
      'Sealing is unavailable on this system, so the token was not saved.'
    )
  })
})

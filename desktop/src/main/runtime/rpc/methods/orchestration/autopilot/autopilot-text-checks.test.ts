import { describe, expect, it } from 'vitest'
import { checkAutopilotText } from './autopilot-text-checks'

// FIXTURE_ONLY: an obviously fake key shape, not a credential.
const FAKE_SECRET = 'sk-0123456789abcdef0123456789abcdef'

describe('checkAutopilotText', () => {
  it('accepts English with newlines, tabs and quoted names in any script', () => {
    expect(checkAutopilotText('Wrote `報告.md`.\n\tAll checks passed.', 100)).toEqual({ ok: true })
  })

  it.each([
    ['text_empty', '   \n'],
    ['control_characters', 'Done.\u001b[31m'],
    ['control_characters', 'Done.\r\nNext.'],
    ['control_characters', 'Done.‮Next.'],
    ['secret_shaped', `The key is ${FAKE_SECRET}.`],
    ['not_english', 'Das Ergebnis ist fertig: 完成'],
    ['not_english', '`only a quoted span`']
  ])('refuses %s in %j', (reason, text) => {
    expect(checkAutopilotText(text, 1000)).toEqual({ ok: false, reason })
  })

  it('counts UTF-16 units like the stores and the params do', () => {
    expect(checkAutopilotText('Saved `𝒳`.', 11)).toEqual({ ok: true })
    expect(checkAutopilotText('Saved `𝒳`.', 10)).toEqual({ ok: false, reason: 'text_too_long' })
  })
})

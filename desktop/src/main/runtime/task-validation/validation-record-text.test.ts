import { describe, expect, it } from 'vitest'
import { hasSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import { recordLine } from './validation-record-text'

// FIXTURE_ONLY: the token below is synthetic and obviously fake.
const FAKE_TOKEN = 'sk-0123456789abcdef0123456789abcdef'

describe('validation record text', () => {
  it('keeps short English text as one line', () => {
    expect(recordLine('The report exists.', { fallback: 'x' })).toBe('The report exists.')
  })

  it('folds line breaks, tabs and control characters into single spaces', () => {
    expect(recordLine('First line.\r\n\tSecond\u0007 line.  ', { fallback: 'x' })).toBe(
      'First line. Second line.'
    )
  })

  it('masks secret shapes, including ones a line break had split', () => {
    const line = recordLine(`Found ${FAKE_TOKEN} and token:\n abcdefgh in the output.`, {
      fallback: 'x'
    })
    expect(line).not.toContain(FAKE_TOKEN)
    expect(line).not.toContain('abcdefgh')
    expect(hasSecretLikeText(line)).toBe(false)
    // The text around a secret survives; only the secret itself is masked.
    expect(line).toBe('Found *** and token: *** in the output.')
  })

  it('bounds the line and never leaves a secret shape that the cut created', () => {
    const line = recordLine(`${'a '.repeat(10)}AKIA0123456789ABCDEFX`, {
      fallback: 'x',
      maxChars: 40
    })
    expect(line.length).toBeLessThanOrEqual(40)
    expect(hasSecretLikeText(line)).toBe(false)
  })

  it('uses the English fallback for text that is not English or ends up empty', () => {
    expect(recordLine('报告已存在。', { fallback: 'The reviewer gave a reason.' })).toBe(
      'The reviewer gave a reason.'
    )
    expect(recordLine(' \n\t ', { fallback: 'No note.' })).toBe('No note.')
  })

  it('refuses a fallback that is itself not a valid record line', () => {
    expect(() => recordLine('ok', { fallback: 'two\nlines' })).toThrow()
    expect(() => recordLine('ok', { fallback: '' })).toThrow()
  })
})

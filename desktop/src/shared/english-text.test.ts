import { describe, expect, it } from 'vitest'
import { isEnglishText } from './english-text'

describe('isEnglishText', () => {
  it.each([
    ['plain ASCII sentence', 'Add a retry button to the queue, then test it (twice)!'],
    ['Latin letters with diacritics', 'Update the café menu and the naïve résumé parser.'],
    ['typographic punctuation', 'Use “quotes” and ‘single’ ones — and an ellipsis…'],
    ['digits and symbols', 'Cap at 2,000 chars; use a+b=c, 50% and #tag @ 10:30 [x] {y} ~z'],
    ['tabs and newlines', 'Line one\n\tLine two\r\nLine three'],
    ['empty text', '']
  ])('accepts %s', (_label, text) => {
    expect(isEnglishText(text)).toBe(true)
  })

  it.each([
    ['CJK', 'Fix the 登录 page'],
    ['Cyrillic', 'Fix the сервер'],
    ['Greek', 'Compute the α value'],
    ['emoji', 'Ship it 🚀'],
    ['non-breaking space', 'Fix this'],
    ['fullwidth digits', 'Use １ here'],
    ['Arabic-Indic digits', 'Use ٣ here'],
    ['currency symbol', 'Costs €5'],
    ['zero-width joiner', 'a‍b'],
    ['fullwidth Latin letters', 'ｈｅｌｌｏ ｗｏｒｌｄ'],
    ['a Latin ligature', 'Open the ﬁle'],
    ['a Latin-script Roman numeral', 'Chapter Ⅻ']
  ])('rejects %s', (_label, text) => {
    expect(isEnglishText(text)).toBe(false)
  })
})

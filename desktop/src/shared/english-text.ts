// Latin script, ASCII digits, ASCII punctuation and symbols, typographic quotes, dashes and ellipsis, ASCII whitespace.
const ENGLISH_TEXT = /^[\p{Script=Latin}0-9 \t\n\r\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E‘’“”–—…]*$/u
const TYPOGRAPHIC_MARKS = /[‘’“”–—…]/g

/** D-013 internal-language check, shared by the Clef state builder and the routing table. */
export function isEnglishText(text: string): boolean {
  const withoutMarks = text.replace(TYPOGRAPHIC_MARKS, '')
  // Why: Latin script includes fullwidth letters, ligatures and Roman numerals, which NFKC rewrites.
  return ENGLISH_TEXT.test(text) && withoutMarks.normalize('NFKC') === withoutMarks
}

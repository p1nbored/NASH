// Characters that can change how a line reads on a terminal or in a list: C0 and C1 controls,
// line and paragraph separators, and bidi embeddings, overrides and isolates (U+202A-E, U+2066-9).
const DISPLAY_CONTROL = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u
const DISPLAY_CONTROLS = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu

export function hasDisplayControls(text: string): boolean {
  return DISPLAY_CONTROL.test(text)
}

/** Each such character becomes one space, so stored text can be shown without rewriting the line. */
export function neutralizeDisplayControls(text: string): string {
  return text.replace(DISPLAY_CONTROLS, ' ')
}

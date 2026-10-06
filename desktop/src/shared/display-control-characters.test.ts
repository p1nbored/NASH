import { describe, expect, it } from 'vitest'
import { hasDisplayControls, neutralizeDisplayControls } from './display-control-characters'

// Characters are written as escapes so no invisible control is spelled out in this source.
const CONTROLS: readonly [string, string][] = [
  ['NUL', '\u0000'],
  ['BEL', '\u0007'],
  ['ESC', '\u001B'],
  ['newline', '\n'],
  ['tab', '\t'],
  ['DEL', '\u007F'],
  ['C1 CSI', '\u009B'],
  ['line separator', '\u2028'],
  ['paragraph separator', '\u2029'],
  ['left-to-right embedding', '\u202A'],
  ['right-to-left override', '\u202E'],
  ['left-to-right isolate', '\u2066'],
  ['pop directional isolate', '\u2069']
]

describe('display control characters', () => {
  it.each(CONTROLS)('finds and neutralises %s as one space', (_label, control) => {
    const text = `Fix${control}probe`
    expect(hasDisplayControls(text)).toBe(true)
    expect(neutralizeDisplayControls(text)).toBe('Fix probe')
  })

  it('leaves ordinary text, any script and emoji-free punctuation alone', () => {
    const text = 'Summarize the layout of `src/main` in Español, 日本語 and عربى.'
    expect(hasDisplayControls(text)).toBe(false)
    expect(neutralizeDisplayControls(text)).toBe(text)
  })

  it('replaces every control, not only the first, and gives the same answer on repeated calls', () => {
    const text = '\u202Ea\u2066b\u0007c'
    expect(neutralizeDisplayControls(text)).toBe(' a b c')
    expect(hasDisplayControls(text)).toBe(true)
    expect(hasDisplayControls(text)).toBe(true)
  })
})

import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildAppFontFamily } from './app-font-family'

const LATIN_FALLBACKS = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"'

// Why (decision D-009): dense controls use the platform's system sans by default.
describe('buildAppFontFamily', () => {
  it('defaults to the system UI font', () => {
    expect(buildAppFontFamily('')).toBe(LATIN_FALLBACKS)
  })

  it('places a custom UI font before the fallback chain', () => {
    expect(buildAppFontFamily('Inter')).toBe(`"Inter", ${LATIN_FALLBACKS}`)
  })

  it('does not duplicate the default font when selected explicitly', () => {
    expect(buildAppFontFamily('system-ui')).toBe(LATIN_FALLBACKS)
  })

  it('still offers the bundled Geist font as an explicit choice', () => {
    expect(buildAppFontFamily('Geist')).toBe(`"Geist", ${LATIN_FALLBACKS}`)
  })

  // Why: main.css appends the per-language CJK families and the generic family after this
  // chain (`--font-sans`); a generic keyword here would resolve first and hide them.
  it('never ends with a generic family, so the CJK fallbacks stay reachable', () => {
    for (const choice of ['', 'Inter', 'Microsoft YaHei UI']) {
      expect(buildAppFontFamily(choice)).not.toMatch(/(?:sans-serif|serif|monospace)$/)
    }
  })

  it('matches the default chain main.css declares before settings load', () => {
    const mainCss = fs.readFileSync(new URL('../assets/main.css', import.meta.url), 'utf8')
    const declared = /\n {2}--app-font-family:\s*([^;]+);/.exec(mainCss)?.[1]
    expect(declared?.replace(/'/g, '"')).toBe(buildAppFontFamily(''))
  })
})

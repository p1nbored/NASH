import { describe, expect, it } from 'vitest'
import { buildAppFontFamily } from './app-font-family'

// Why (decision D-009): dense controls use the platform's system sans by default.
describe('buildAppFontFamily', () => {
  it('defaults to the system UI font', () => {
    expect(buildAppFontFamily('')).toBe(
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    )
  })

  it('places a custom UI font before the fallback chain', () => {
    expect(buildAppFontFamily('Inter')).toBe(
      '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    )
  })

  it('does not duplicate the default font when selected explicitly', () => {
    expect(buildAppFontFamily('system-ui')).toBe(
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    )
  })

  it('still offers the bundled Geist font as an explicit choice', () => {
    expect(buildAppFontFamily('Geist')).toBe(
      '"Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    )
  })
})

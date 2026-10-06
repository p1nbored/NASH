import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTOPILOT_MONACO_THEMES,
  defineAutopilotMonacoThemes,
  monacoThemeName
} from './monaco-theme'

const mainCss = fs.readFileSync(new URL('../assets/main.css', import.meta.url), 'utf8')

function token(selector: string, name: string): string {
  const body = new RegExp(`\\n${selector}\\s*{([\\s\\S]*?)\\n}`).exec(mainCss)?.[1] ?? ''
  return new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? ''
}

describe('autopilot Monaco themes', () => {
  it('maps the app theme to the matching editor theme', () => {
    expect(monacoThemeName(false)).toBe('autopilot-light')
    expect(monacoThemeName(true)).toBe('autopilot-dark')
  })

  // Why: the editor paints its own background; it must match the app's editor surface token.
  it.each([
    ['autopilot-light', ':root'],
    ['autopilot-dark', '\\.dark']
  ] as const)('%s follows the frozen surface and ink tokens', (name, selector) => {
    const colors = AUTOPILOT_MONACO_THEMES[name].colors
    expect(colors['editor.background']).toBe(token(selector, '--editor-surface'))
    expect(colors['editor.foreground']).toBe(token(selector, '--foreground'))
    expect(colors['editorLineNumber.foreground']).toBe(token(selector, '--muted-foreground'))
  })

  it('registers both themes on the built-in vs bases', () => {
    const defineTheme = vi.fn()
    defineAutopilotMonacoThemes({ editor: { defineTheme } })
    expect(defineTheme).toHaveBeenCalledWith(
      'autopilot-light',
      expect.objectContaining({ base: 'vs', inherit: true })
    )
    expect(defineTheme).toHaveBeenCalledWith(
      'autopilot-dark',
      expect.objectContaining({ base: 'vs-dark', inherit: true })
    )
  })
  // Why: setup swallows step errors and Monaco falls back to 'vs' for unknown names, so a missing
  // registration step would silently render every dark editor light.
  it('registers the themes during Monaco setup before the loader is configured', () => {
    const setup = fs.readFileSync(new URL('./monaco-setup.ts', import.meta.url), 'utf8')
    const step = setup.indexOf('defineAutopilotMonacoThemes(monaco)')
    expect(step).toBeGreaterThan(-1)
    expect(setup).toMatch(/['autopilot editor themes', () => defineAutopilotMonacoThemes(monaco)]/)
    const loaderConfig = setup.indexOf('loader.config(')
    expect(loaderConfig === -1 || step < loaderConfig).toBe(true)
  })
})

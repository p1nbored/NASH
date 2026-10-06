import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../constants'
import {
  DEFAULT_TERMINAL_THEME_DARK,
  DEFAULT_TERMINAL_THEME_LIGHT,
  selectTerminalTheme
} from '../terminal-theme-selection'
import { AUTOPILOT_TERMINAL_DIVIDER_DARK, AUTOPILOT_TERMINAL_DIVIDER_LIGHT } from './autopilot'
import { TERMINAL_THEME_CATALOG } from './index'

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  )
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

function oklchChroma(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return Math.hypot(a, bb)
}

const TEXT_COLORS = [
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightBlack'
] as const

describe('autopilot terminal themes', () => {
  it('ships the frozen charcoal and paper themes as built-ins', () => {
    expect(TERMINAL_THEME_CATALOG['Autopilot Charcoal']).toBeDefined()
    expect(TERMINAL_THEME_CATALOG['Autopilot Paper']).toBeDefined()
  })

  for (const name of ['Autopilot Charcoal', 'Autopilot Paper']) {
    it(`${name} keeps every ANSI text color readable`, () => {
      const theme = TERMINAL_THEME_CATALOG[name]
      const background = theme.background as string
      expect(contrast(theme.foreground as string, background)).toBeGreaterThanOrEqual(7)
      for (const key of TEXT_COLORS) {
        expect(contrast(theme[key] as string, background), key).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  // Why: round-0 critique found pass/warn/diff colours too close to the foreground; keep them saturated.
  it('keeps Charcoal semantic ANSI colours saturated enough to read apart from the foreground', () => {
    const theme = TERMINAL_THEME_CATALOG['Autopilot Charcoal']
    for (const key of ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const) {
      expect(oklchChroma(theme[key] as string), key).toBeGreaterThanOrEqual(0.12)
    }
  })

  // Why (decision D-009): the warm charcoal terminal is the default in both shells.
  it('defaults both app themes to the charcoal terminal', () => {
    const settings = getDefaultSettings('~')
    expect(DEFAULT_TERMINAL_THEME_DARK).toBe('Autopilot Charcoal')
    expect(DEFAULT_TERMINAL_THEME_LIGHT).toBe('Autopilot Paper')
    expect(settings.terminalThemeDark).toBe('Autopilot Charcoal')
    expect(settings.terminalThemeLight).toBe('Autopilot Paper')
    expect(settings.terminalUseSeparateLightTheme).toBe(false)
    expect(settings.terminalDividerColorDark).toBe(AUTOPILOT_TERMINAL_DIVIDER_DARK)
    expect(settings.terminalDividerColorLight).toBe(AUTOPILOT_TERMINAL_DIVIDER_LIGHT)
    expect(selectTerminalTheme({ ...settings, theme: 'light' }, false).themeName).toBe(
      'Autopilot Charcoal'
    )
  })

  // Why: renderer and picker fallbacks must match the defaults so a cleared colour never turns cool grey.
  // Why: __dirname, not import.meta, because the CLI's CommonJS tsconfig compiles src/shared.
  it('keeps one source for the divider defaults and their fallbacks', () => {
    const renderer = readFileSync(
      join(__dirname, '../../renderer/src/lib/terminal-theme.ts'),
      'utf8'
    )
    const picker = readFileSync(
      join(__dirname, '../../renderer/src/components/settings/TerminalThemeSections.tsx'),
      'utf8'
    )
    for (const source of [renderer, picker]) {
      expect(source).not.toMatch(/#3f3f46|#d4d4d8/)
    }
    expect(renderer).toContain('AUTOPILOT_TERMINAL_DIVIDER_DARK')
    expect(picker).toContain('DEFAULT_TERMINAL_DIVIDER_LIGHT')
  })
})

import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainCss = fs.readFileSync(new URL('./main.css', import.meta.url), 'utf8')
const themeBlock = /@theme inline\s*{([\s\S]*?)\n}/.exec(mainCss)?.[1] ?? ''

function block(selector: string): Record<string, string> {
  const body = new RegExp(`\\n${selector}\\s*{([\\s\\S]*?)\\n}`).exec(mainCss)?.[1] ?? ''
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])
  )
}

function channels(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  )
  return [r, g, b]
}

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(linear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

function oklabDistance(first: string, second: string): number {
  const [a, b] = [oklab(first), oklab(second)]
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function oklchHue(hex: string): number {
  const [, a, b] = oklab(hex)
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
}

function hue(hex: string): number {
  const [r, g, b] = channels(hex)
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  if (delta === 0) {
    return -1
  }
  const raw =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (raw * 60 + 360) % 360
}

const themes = { light: block(':root'), dark: block('\\.dark') } as const
const SECURITY_PARITY_EXCEPTIONS = new Set(['primary', 'primary-foreground'])

// Why: the frozen D12 Paper direction (decision D-009) is the product identity;
// these checks keep later token edits from silently losing contrast or warmth.
describe('autopilot frozen theme tokens', () => {
  for (const [name, tokens] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      const pairs: [string, string, number][] = [
        ['--foreground', '--background', 7],
        ['--foreground', '--worktree-sidebar', 7],
        ['--foreground', '--worktree-sidebar-accent', 7],
        ['--muted-foreground', '--background', 4.5],
        ['--muted-foreground', '--muted', 4.5],
        ['--muted-foreground', '--accent', 4.5],
        ['--muted-foreground', '--worktree-sidebar', 4.5],
        ['--primary-foreground', '--primary', 4.5],
        ['--destructive-foreground', '--destructive', 4.5],
        ['--ring', '--background', 3],
        ['--ring', '--worktree-sidebar', 3],
        ['--ring', '--worktree-sidebar-accent', 3],
        ['--tab-group-split-divider', '--card', 3],
        ['--destructive', '--background', 4.5],
        ['--agent-question', '--background', 3],
        ['--agent-question', '--worktree-sidebar', 3],
        ['--agent-question', '--worktree-sidebar-accent', 3]
      ]
      for (const [foreground, background, minimum] of pairs) {
        it(`${foreground} on ${background} meets ${minimum}:1`, () => {
          expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(minimum)
        })
      }

      it('uses warm paper neutrals and a clay primary rather than pure greys', () => {
        expect(hue(tokens['--background'])).toBeGreaterThan(20)
        expect(hue(tokens['--background'])).toBeLessThan(60)
        expect(hue(tokens['--primary'])).toBeGreaterThan(5)
        expect(hue(tokens['--primary'])).toBeLessThan(25)
      })

      // Why: destructive actions sit beside clay primary buttons; they must not read as the same hue.
      it('keeps destructive red clearly apart from the clay primary', () => {
        expect(oklabDistance(tokens['--destructive'], tokens['--primary'])).toBeGreaterThanOrEqual(
          0.08
        )
        const gap = Math.abs(oklchHue(tokens['--primary']) - oklchHue(tokens['--destructive']))
        expect(Math.min(gap, 360 - gap)).toBeGreaterThanOrEqual(20)
      })

      // Why: a clay focus ring reads as a validation error; focus stays neutral ink like security chrome.
      it('draws focus with the neutral ring, not the clay primary', () => {
        expect(tokens['--ring']).not.toBe(tokens['--primary'])
        expect(tokens['--sidebar-ring']).toBe(tokens['--ring'])
        expect(tokens['--ring']).toBe(tokens['--orca-security-ring'])
      })

      it('keeps every host-owned security token equal to its app token except the ink primary', () => {
        const securityNames = Object.keys(tokens)
          .filter((key) => key.startsWith('--orca-security-'))
          .map((key) => key.slice('--orca-security-'.length))
        expect(securityNames.length).toBeGreaterThanOrEqual(17)
        for (const role of securityNames) {
          if (SECURITY_PARITY_EXCEPTIONS.has(role)) {
            continue
          }
          expect(tokens[`--orca-security-${role}`], role).toBe(tokens[`--${role}`])
        }
        expect(tokens['--orca-security-primary']).toBe(tokens['--foreground'])
        expect(tokens['--orca-security-primary-foreground']).toBe(tokens['--background'])
      })
    })
  }

  it('defines a display serif token and exposes it to Tailwind', () => {
    expect(themes.light['--app-display-font-family']).toMatch(/Georgia/)
    expect(themeBlock).toMatch(/--font-display:\s*var\(--app-display-font-family\)/)
  })
})

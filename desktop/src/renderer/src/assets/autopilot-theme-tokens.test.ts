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

function mixHex(foreground: string, background: string, weight: number): string {
  const [fg, bg] = [channels(foreground), channels(background)]
  return `#${fg
    .map((value, index) =>
      Math.round((value * weight + bg[index] * (1 - weight)) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** Follows `var(--x)` aliases so state tokens defined as aliases still get a measured hex. */
function resolveHex(tokens: Record<string, string>, name: string): string {
  const value = tokens[name]
  const alias = /^var\((--[\w-]+)\)$/.exec(value ?? '')?.[1]
  if (alias) {
    return resolveHex(tokens, alias)
  }
  expect(value, `${name} must resolve to a hex colour`).toMatch(/^#[0-9a-f]{6}$/i)
  return value
}

/** A `color-mix(in srgb, var(--x) N%, transparent)` tint as it renders over `surface`. */
function tintOver(tokens: Record<string, string>, name: string, surface: string): string {
  const match = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, transparent\)$/.exec(
    tokens[name] ?? ''
  )
  expect(match, `${name} must be a transparent tint of a token`).not.toBeNull()
  const [, source, percent] = match ?? []
  return mixHex(resolveHex(tokens, source), resolveHex(tokens, surface), Number(percent) / 100)
}

const themes = { light: block(':root'), dark: block('\\.dark') } as const
const SECURITY_PARITY_EXCEPTIONS = new Set(['primary', 'primary-foreground'])
const CONTROL_SURFACES = ['--background', '--card', '--popover', '--muted', '--worktree-sidebar']
// Hover is the accent role; Tailwind maps bg-hover straight to --accent.
const STATUS_SURFACES = [...CONTROL_SURFACES, '--accent']

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

      // Why: state colours are new semantic roles; each must stay readable wherever it lands.
      describe('state colours', () => {
        const hex = (name: string): string => resolveHex(tokens, name)

        it('keeps ink and muted text readable on hover and selected rows', () => {
          for (const surface of ['--accent', '--selected']) {
            expect(contrast(hex('--foreground'), hex(surface))).toBeGreaterThanOrEqual(7)
            expect(contrast(hex('--muted-foreground'), hex(surface))).toBeGreaterThanOrEqual(4.5)
            expect(contrast(hex('--ring'), hex(surface))).toBeGreaterThanOrEqual(3)
          }
        })

        it('makes a selected row a step stronger than a hovered one', () => {
          const [hover, selected] = [hex('--accent'), hex('--selected')].map((value) =>
            contrast(value, hex('--popover'))
          )
          expect(selected).toBeGreaterThan(hover)
        })

        it.each(CONTROL_SURFACES)('draws control borders at 3:1 or more on %s', (surface) => {
          expect(contrast(hex('--control-border'), hex(surface))).toBeGreaterThanOrEqual(3)
        })

        it('keeps the control border at 3:1 against a dark-mode field fill', () => {
          // Inputs paint `dark:bg-input/30` inside the border.
          const fill = mixHex(hex('--input'), hex('--background'), 0.3)
          expect(contrast(hex('--control-border'), fill)).toBeGreaterThanOrEqual(3)
        })

        it.each(CONTROL_SURFACES)(
          'keeps disabled text legible yet quieter than muted text on %s',
          (surface) => {
            const disabled = contrast(hex('--disabled-foreground'), hex(surface))
            expect(disabled).toBeGreaterThanOrEqual(3)
            expect(disabled).toBeLessThan(contrast(hex('--muted-foreground'), hex(surface)))
          }
        )

        for (const status of ['success', 'warning', 'error']) {
          it.each(STATUS_SURFACES)(
            `keeps status-${status} text at 4.5:1 on %s and on its own tint there`,
            (surface) => {
              const text = hex(`--status-${status}`)
              expect(contrast(text, hex(surface))).toBeGreaterThanOrEqual(4.5)
              const tint = tintOver(tokens, `--status-${status}-background`, surface)
              expect(contrast(text, tint)).toBeGreaterThanOrEqual(4.5)
              expect(contrast(hex('--foreground'), tint)).toBeGreaterThanOrEqual(7)
            }
          )

          it(`defines the status-${status} border as a tint of its text colour`, () => {
            expect(tokens[`--status-${status}-border`]).toBe(
              `color-mix(in srgb, var(--status-${status}) 25%, transparent)`
            )
          })
        }

        it('keeps the error text in the crimson family, apart from clay', () => {
          expect(oklabDistance(hex('--status-error'), hex('--primary'))).toBeGreaterThanOrEqual(
            0.08
          )
          expect(oklabDistance(hex('--status-error'), hex('--destructive'))).toBeLessThan(0.08)
        })

        it('separates floating surfaces from the canvas with a visible edge', () => {
          expect(contrast(hex('--floating-border'), hex('--background'))).toBeGreaterThan(
            contrast(hex('--border'), hex('--background'))
          )
        })
      })

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

  it('maps every state colour into Tailwind', () => {
    for (const role of [
      'selected',
      'disabled-foreground',
      'status-error',
      'status-error-background',
      'status-error-border',
      'floating-border',
      'scrim'
    ]) {
      expect(themeBlock, role).toMatch(new RegExp(`--color-${role}:\\s*var\\(--${role}\\);`))
    }
    // Why: aliases resolve per element, so scoped overrides of --accent/--foreground carry through.
    expect(themeBlock).toMatch(/--color-hover:\s*var\(--accent\);/)
    expect(themeBlock).toMatch(/--color-selected-foreground:\s*var\(--foreground\);/)
    expect(themeBlock).toMatch(/--color-control:\s*var\(--control-border\);/)
    expect(themeBlock).toMatch(/--shadow-floating:\s*var\(--floating-shadow\);/)
  })

  it('defines every state colour in both themes', () => {
    for (const tokens of Object.values(themes)) {
      for (const name of [
        '--selected',
        '--control-border',
        '--disabled-foreground',
        '--status-error',
        '--status-error-background',
        '--status-error-border',
        '--floating-border',
        '--floating-shadow',
        '--scrim'
      ]) {
        expect(tokens[name], name).toBeDefined()
      }
    }
  })
})

describe('font stacks', () => {
  const root = themes.light
  const flat = (value: string | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()

  it('keeps the user-overridable UI family Latin-only and appends CJK and generic fallbacks', () => {
    expect(flat(root['--app-font-family'])).toBe(
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI'"
    )
    expect(flat(root['--font-sans'])).toBe(
      'var(--app-font-family), var(--app-cjk-font-family), sans-serif'
    )
  })

  it('uses bundled CJK families for the same sans and serif roles in every language', () => {
    expect(root['--app-cjk-font-family']).toBe("'Noto Sans CJK'")
    expect(root['--app-cjk-serif-font-family']).toBe("'Noto Serif CJK'")
    for (const file of ['NotoSansCJKsc-VF.woff2', 'NotoSerifCJKsc-Regular.woff2']) {
      expect(
        fs
          .readFileSync(new URL(`./fonts/${file}`, import.meta.url))
          .subarray(0, 4)
          .toString()
      ).toBe('wOF2')
    }
  })

  it('gives the display serif and the monospace stacks CJK fallbacks', () => {
    const display = flat(root['--app-display-font-family'])
    expect(display).toMatch(/^Georgia,/)
    expect(display).toMatch(/var\(--app-cjk-serif-font-family\), serif$/)
    expect(flat(root['--font-mono'])).toMatch(/var\(--app-cjk-font-family\), monospace$/)
  })

  it('lists Cascadia Mono before Cascadia Code, as DESIGN.md specifies', () => {
    const mono = root['--font-mono']
    expect(mono.indexOf("'Cascadia Mono'")).toBeGreaterThan(-1)
    expect(mono.indexOf("'Cascadia Mono'")).toBeLessThan(mono.indexOf("'Cascadia Code'"))
  })

  it('renders the body with the composed sans stack', () => {
    expect(mainCss).toMatch(/\n {2}body {[^}]*font-family: var\(--font-sans\);/)
  })
})

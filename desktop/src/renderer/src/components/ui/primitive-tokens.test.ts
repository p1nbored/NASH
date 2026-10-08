import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const UI_DIR = __dirname
const files = readdirSync(UI_DIR).filter(
  (name) => name.endsWith('.tsx') && !name.includes('.test.')
)
const source = (file: string): string => readFileSync(join(UI_DIR, file), 'utf8')

// Why: primitives are the design language's single source; a raw value here spreads to every
// screen. Colours, radii, elevation and focus must come from main.css tokens.
const FORBIDDEN: [string, RegExp][] = [
  ['raw black/white palette colour', /\b(?:bg|text|border|ring|fill|stroke)-(?:black|white)\b/],
  ['arbitrary colour value', /-\[(?:rgba?|hsla?|#)/],
  ['arbitrary shadow', /\bshadow-\[/],
  ['arbitrary radius', /\brounded-\[(?!inherit\])/],
  ['arbitrary font weight', /\bfont-\[\d+\]/],
  ['arbitrary line height', /\bleading-\[\d+px\]/],
  ['glass blur on a surface', /\bbackdrop-blur-(?:sm|md|lg|xl|2xl|3xl)\b/],
  ['translucent focus ring', /\bfocus(?:-visible)?:ring-ring\/\d+/]
]

// Why: these primitives sit inside cn() next to a text colour, which tailwind-merge would let
// drop `text-caption`; they keep the 10-11px literal until cn() learns the type scale.
const PENDING_TYPE_SCALE_LITERALS: Record<string, number> = {
  'badge.tsx': 1,
  'context-menu.tsx': 2,
  'dropdown-menu.tsx': 2
}

const PILL_SHAPED = new Set([
  'badge.tsx',
  'progress.tsx',
  'scroll-area.tsx',
  'slider.tsx',
  'switch.tsx'
])

describe('ui primitives use design tokens', () => {
  it.each(files)('%s has no raw colour, shadow, radius, weight, blur or halo', (file) => {
    const text = source(file)
    for (const [label, pattern] of FORBIDDEN) {
      expect(pattern.exec(text)?.[0], `${file}: ${label}`).toBeUndefined()
    }
  })

  it.each(files)('%s keeps arbitrary pixel font sizes to the known pending cases', (file) => {
    const literals = source(file).match(/\btext-\[\d+px\]/g) ?? []
    expect(literals.length, file).toBe(PENDING_TYPE_SCALE_LITERALS[file] ?? 0)
  })

  it.each(files)('%s only rounds to a pill where the control is a track or a count', (file) => {
    if (!PILL_SHAPED.has(file)) {
      expect(source(file), file).not.toMatch(/\brounded-full\b/)
    }
  })

  // Why: menus, popovers, dialogs and sheets sit side by side; one opaque paper recipe
  // (edge, fill, shadow) keeps them a family and replaces the cold glass panels.
  it.each([
    ['popover.tsx', 1],
    ['select.tsx', 1],
    ['dropdown-menu.tsx', 2],
    ['context-menu.tsx', 2],
    ['hover-card.tsx', 1],
    ['dialog.tsx', 1],
    ['sheet.tsx', 1],
    ['command.tsx', 1]
  ])('%s paints every floating layer with the floating surface tokens', (file, layers) => {
    const text = source(file)
    const count = (token: string): number =>
      text.match(new RegExp(`\\b${token}\\b`, 'g'))?.length ?? 0
    expect(count('border-floating-border'), file).toBe(layers)
    expect(count('shadow-floating'), file).toBe(layers)
    // The inline Command root also uses the popover fill.
    expect(count('bg-popover'), file).toBeGreaterThanOrEqual(layers)
  })

  it.each(['dialog.tsx', 'sheet.tsx', 'command.tsx'])(
    '%s dims the page with the scrim token',
    (file) => {
      expect(source(file)).toMatch(/\bbg-scrim\b/)
    }
  )

  it('rounds dialogs at the dialog radius and floating menus at the panel radius', () => {
    expect(source('dialog.tsx')).toMatch(/\brounded-xl\b/)
    expect(source('command.tsx')).toMatch(/\brounded-xl\b/)
    for (const file of [
      'popover.tsx',
      'select.tsx',
      'dropdown-menu.tsx',
      'context-menu.tsx',
      'hover-card.tsx'
    ]) {
      expect(source(file), file).toMatch(/\brounded-lg\b/)
    }
  })

  it('highlights the active menu, select and command item with the selected token', () => {
    for (const file of ['dropdown-menu.tsx', 'context-menu.tsx', 'select.tsx']) {
      expect(source(file), file).toMatch(/\bfocus:bg-selected\b/)
    }
    expect(source('command.tsx')).toMatch(/data-\[selected=true\]:bg-selected\b/)
  })

  it('draws interactive control edges with the control border token', () => {
    for (const file of ['input.tsx', 'textarea.tsx', 'select.tsx', 'checkbox.tsx']) {
      expect(source(file), file).toMatch(/\bborder-control\b/)
    }
    expect(source('switch.tsx')).toMatch(/data-\[state=unchecked\]:bg-control\b/)
  })
})

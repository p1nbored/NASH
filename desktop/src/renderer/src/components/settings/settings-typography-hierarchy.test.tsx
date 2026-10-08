import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SettingsSubsectionHeader } from './SettingsFormControls'

// Steps above the 14px (text-sm / text-body-lg) setting label; text-heading is the 15px token.
const HEADING_STEPS = ['text-heading', 'text-base', 'text-lg', 'text-title']
const LABEL_OR_SMALLER = [
  'text-sm',
  'text-body-lg',
  'text-body',
  'text-xs',
  'text-meta',
  'text-caption'
]

// Why: group headings must outrank the 14px semibold setting labels beneath them (D12 hierarchy).
describe('settings typography hierarchy', () => {
  it('sets subsection headings in the display serif one step above setting labels', () => {
    const markup = renderToStaticMarkup(<SettingsSubsectionHeader title="Navigation" />)
    const classes = /<h3 class="([^"]*)"/.exec(markup)?.[1].split(/\s+/) ?? []
    expect(classes).toEqual(expect.arrayContaining(['font-display', 'font-normal']))
    expect(classes.filter((name) => HEADING_STEPS.includes(name))).toHaveLength(1)
    expect(classes.some((name) => LABEL_OR_SMALLER.includes(name))).toBe(false)
    expect(classes).not.toContain('font-semibold')
  })

  // Why: a bg-muted pill vanished on the light sidebar (1.01:1); an outline reads in both themes.
  it('draws sidebar maturity badges as outlined pills rather than muted fills', () => {
    const source = readFileSync(join(__dirname, 'SettingsSidebar.tsx'), 'utf8')
    const badge =
      /<span className="([^"]*uppercase tracking-wider[^"]*)">\s*\{section\.badge\}/.exec(
        source
      )?.[1]
    expect(badge).toBeDefined()
    expect(badge).toContain('border-border')
    expect(badge).not.toContain('bg-muted')
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'tailwindcss'
import { beforeAll, describe, expect, it } from 'vitest'

const cssPath = fileURLToPath(new URL('./main.css', import.meta.url))
const tailwindIndex = fileURLToPath(import.meta.resolve('tailwindcss/index.css'))

type Compiler = Awaited<ReturnType<typeof compile>>
let compiler: Compiler

// Why: a token that is only a CSS variable generates no utility; compiling main.css proves that
// the names other packages write (`text-meta`, `p-row`, `bg-hover`) produce the declared values.
async function compileMainCss(): Promise<Compiler> {
  return compile(fs.readFileSync(cssPath, 'utf8'), {
    base: path.dirname(cssPath),
    loadStylesheet: async (id, base) =>
      id === 'tailwindcss'
        ? {
            path: tailwindIndex,
            base: path.dirname(tailwindIndex),
            content: fs.readFileSync(tailwindIndex, 'utf8')
          }
        : // Third-party and sibling stylesheets carry no theme tokens.
          { path: id, base, content: '' }
  })
}

function ruleFor(candidate: string): string {
  const css = compiler.build([candidate])
  const selector = `.${candidate.replace(/[[\]/:.()]/g, '\\$&')} {`
  const start = css.indexOf(selector)
  expect(start, `${candidate} generated no rule`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start) + 1)
}

function themeVariable(name: string): string | undefined {
  // `@theme static` emits the scale even when no utility uses it, for hand-written CSS.
  const css = compiler.build([])
  return new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim()
}

beforeAll(async () => {
  compiler = await compileMainCss()
})

describe('type scale utilities', () => {
  const scale: [string, string, string][] = [
    ['caption', '0.6875rem', '1rem'],
    ['meta', '0.75rem', '1rem'],
    ['body', '0.8125rem', '1.25rem'],
    ['body-lg', '0.875rem', '1.25rem'],
    ['heading', '0.9375rem', '1.375rem'],
    ['title', '1.25rem', '1.75rem'],
    ['display', '1.625rem', '2.125rem']
  ]

  it.each(scale)('text-%s sets %s on a %s line', (name, size, lineHeight) => {
    const rule = ruleFor(`text-${name}`)
    expect(rule).toContain(`font-size: var(--text-${name})`)
    expect(rule).toContain(`var(--text-${name}--line-height)`)
    expect(themeVariable(`--text-${name}`)).toBe(size)
    expect(themeVariable(`--text-${name}--line-height`)).toBe(lineHeight)
  })

  it('keeps the default Tailwind sizes the primitives still use', () => {
    for (const name of ['xs', 'sm', 'base', 'xl']) {
      expect(ruleFor(`text-${name}`)).toContain(`font-size: var(--text-${name})`)
    }
  })
})

describe('spacing role utilities', () => {
  it.each([
    ['row', '0.5rem'],
    ['group', '1rem'],
    ['section', '1.5rem']
  ])('%s spacing is %s and reaches padding, gap and margin', (name, value) => {
    expect(ruleFor(`p-${name}`)).toContain(`padding: var(--spacing-${name})`)
    expect(ruleFor(`gap-${name}`)).toContain(`gap: var(--spacing-${name})`)
    expect(ruleFor(`mt-${name}`)).toContain(`margin-top: var(--spacing-${name})`)
    expect(themeVariable(`--spacing-${name}`)).toBe(value)
  })

  it('keeps the numeric spacing scale', () => {
    expect(ruleFor('p-2')).toContain('padding: calc(var(--spacing) * 2)')
  })
})

describe('radius utilities', () => {
  // Why: 6-10px corners; larger Tailwind radii are capped so no surface drifts into pill shapes.
  it.each([
    ['sm', 'calc(var(--radius) - 2px)'],
    ['md', 'var(--radius)'],
    ['lg', 'calc(var(--radius) + 2px)'],
    ['xl', 'calc(var(--radius) + 4px)'],
    ['2xl', 'calc(var(--radius) + 4px)'],
    ['3xl', 'calc(var(--radius) + 4px)'],
    ['4xl', 'calc(var(--radius) + 4px)']
  ])('rounded-%s resolves to %s', (name, value) => {
    expect(ruleFor(`rounded-${name}`)).toContain(`border-radius: ${value}`)
  })
})

describe('state colour utilities', () => {
  it.each([
    ['bg-hover', 'background-color: var(--accent)'],
    ['bg-selected', 'background-color: var(--selected)'],
    ['text-selected-foreground', 'color: var(--foreground)'],
    ['border-control', 'border-color: var(--control-border)'],
    ['text-disabled-foreground', 'color: var(--disabled-foreground)'],
    ['text-status-error', 'color: var(--status-error)'],
    ['bg-status-error-background', 'background-color: var(--status-error-background)'],
    ['border-status-error-border', 'border-color: var(--status-error-border)'],
    ['border-floating-border', 'border-color: var(--floating-border)'],
    ['bg-scrim', 'background-color: var(--scrim)']
  ])('%s generates %s', (candidate, declaration) => {
    expect(ruleFor(candidate)).toContain(declaration)
  })

  it('themes the floating shadow instead of fixing one rgba', () => {
    expect(ruleFor('shadow-floating')).toContain('var(--floating-shadow)')
  })
})

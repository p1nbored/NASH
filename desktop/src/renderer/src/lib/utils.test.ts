import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cn } from './utils'

const mainCss = fs.readFileSync(new URL('../assets/main.css', import.meta.url), 'utf8')
const tokenNames = (namespace: string): string[] =>
  [...mainCss.matchAll(new RegExp(`\\n {2}--${namespace}-([a-z][\\w-]*?):`, 'g'))]
    .map(([, name]) => name)
    .filter((name) => !name.includes('--'))

// Why: tailwind-merge filed `text-meta` under text colour and silently dropped it next to
// `text-muted-foreground`; every token name in main.css must merge as what it is.
describe('cn with design tokens', () => {
  it.each(tokenNames('text'))('keeps text-%s beside a text colour', (name) => {
    expect(cn(`text-${name}`, 'text-muted-foreground')).toBe(`text-${name} text-muted-foreground`)
    expect(cn('text-muted-foreground', `text-${name}`)).toBe(`text-muted-foreground text-${name}`)
  })

  it.each(tokenNames('text'))('lets a later size replace text-%s', (name) => {
    expect(cn(`text-${name}`, 'text-xs')).toBe('text-xs')
  })

  it.each(tokenNames('spacing'))('treats %s as spacing', (name) => {
    expect(cn(`p-${name}`, 'p-2')).toBe('p-2')
    expect(cn('gap-1', `gap-${name}`)).toBe(`gap-${name}`)
  })

  it('finds the whole type scale and the spacing roles in main.css', () => {
    expect(tokenNames('text')).toEqual([
      'caption',
      'meta',
      'body',
      'body-lg',
      'heading',
      'title',
      'display'
    ])
    expect(tokenNames('spacing')).toEqual(['row', 'group', 'section'])
  })
})

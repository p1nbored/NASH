import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Input } from './input'
import { Textarea } from './textarea'

function classesOf(element: React.JSX.Element): string[] {
  const markup = renderToStaticMarkup(element)
  return (/class="([^"]*)"/.exec(markup)?.[1] ?? '').split(/\s+/)
}

describe('Input', () => {
  // Why: a decorative hairline (1.5:1) does not identify a field; control edges clear 3:1.
  it('draws its edge with the control border token', () => {
    expect(classesOf(<Input />)).toContain('border-control')
  })

  it('shows a solid ink focus indicator, never a translucent halo alone', () => {
    const classes = classesOf(<Input />)
    expect(classes).toEqual(
      expect.arrayContaining([
        'focus-visible:border-ring',
        'focus-visible:ring-1',
        'focus-visible:ring-ring'
      ])
    )
    expect(classes.some((name) => /ring-ring\/\d+$/.test(name))).toBe(false)
  })

  it('marks disabled fields with state tokens at full opacity', () => {
    const classes = classesOf(<Input disabled />)
    expect(classes).toEqual(
      expect.arrayContaining([
        'disabled:bg-muted',
        'disabled:text-disabled-foreground',
        'disabled:border-border'
      ])
    )
    expect(classes).not.toContain('disabled:opacity-50')
  })

  it.each([
    ['default', ['h-9', 'rounded-md']],
    ['sm', ['h-8', 'text-xs', 'rounded-md']],
    ['xs', ['h-7', 'text-xs', 'rounded-md']]
  ] as const)('offers the %s size as a variant', (size, expected) => {
    const markup = renderToStaticMarkup(<Input size={size} />)
    expect(markup).toContain(`data-size="${size}"`)
    expect(classesOf(<Input size={size} />)).toEqual(expect.arrayContaining([...expected]))
  })

  it('lets a caller class override a size class', () => {
    const classes = classesOf(<Input size="sm" className="h-10" />)
    expect(classes).toContain('h-10')
    expect(classes).not.toContain('h-8')
  })
})

describe('Textarea', () => {
  it('shares the field edge, focus and disabled tokens', () => {
    const classes = classesOf(<Textarea disabled />)
    expect(classes).toEqual(
      expect.arrayContaining([
        'border-control',
        'focus-visible:border-ring',
        'focus-visible:ring-1',
        'focus-visible:ring-ring',
        'disabled:text-disabled-foreground'
      ])
    )
  })
})

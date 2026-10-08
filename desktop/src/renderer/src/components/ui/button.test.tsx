import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

function classesOf(element: React.JSX.Element): string[] {
  const markup = renderToStaticMarkup(element)
  return (/class="([^"]*)"/.exec(markup)?.[1] ?? '').split(/\s+/)
}

describe('Button', () => {
  // Why: a 50% halo measured about 2:1; the direction's focus floor is 3:1 on every surface.
  it.each(['default', 'secondary', 'ghost', 'link', 'outline', 'destructive'] as const)(
    'draws a solid neutral focus ring for the %s variant',
    (variant) => {
      const classes = classesOf(<Button variant={variant}>Go</Button>)
      expect(classes).toContain('focus-visible:ring-2')
      expect(classes).toContain('focus-visible:ring-ring')
      expect(
        classes.some((name) => /^focus-visible:ring-(ring|destructive)\/\d+$/.test(name))
      ).toBe(false)
      expect(classes.some((name) => name.startsWith('dark:focus-visible:ring-'))).toBe(false)
    }
  )

  it('keeps a disabled primary visible as an outlined muted button at full opacity', () => {
    const classes = classesOf(<Button disabled>Register</Button>)
    expect(classes).toEqual(
      expect.arrayContaining([
        'disabled:bg-muted',
        'disabled:text-muted-foreground',
        'disabled:opacity-100',
        'disabled:ring-1',
        'disabled:ring-inset',
        'disabled:ring-input'
      ])
    )
    expect(classes).not.toContain('disabled:opacity-50')
  })

  it('pairs the destructive fill with its token foreground in both themes', () => {
    const classes = classesOf(<Button variant="destructive">Delete</Button>)
    expect(classes).toEqual(
      expect.arrayContaining(['bg-destructive', 'text-destructive-foreground'])
    )
    expect(classes).not.toContain('text-white')
    expect(classes.some((name) => name.startsWith('dark:bg-destructive'))).toBe(false)
  })

  it.each(['ghost', 'outline'] as const)(
    'hovers the %s variant with the hover token',
    (variant) => {
      const classes = classesOf(<Button variant={variant}>Open</Button>)
      expect(classes).toContain('hover:bg-hover')
      expect(classes).not.toContain('hover:bg-accent')
    }
  )

  it('keeps the outline variant on the hairline border callers rely on', () => {
    expect(classesOf(<Button variant="outline">Refresh</Button>)).toEqual(
      expect.arrayContaining(['border', 'border-border'])
    )
  })

  it('keeps the half-opacity disabled treatment for non-primary variants', () => {
    expect(
      classesOf(
        <Button variant="ghost" disabled>
          Refresh
        </Button>
      )
    ).toContain('disabled:opacity-50')
  })
})

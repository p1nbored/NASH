import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Separator } from './separator'

function classesOf(element: React.JSX.Element): string[] {
  const markup = renderToStaticMarkup(element)
  return (/class="([^"]*)"/.exec(markup)?.[1] ?? '').split(/\s+/)
}

describe('Separator', () => {
  it('draws the decorative hairline by default', () => {
    const markup = renderToStaticMarkup(<Separator />)
    expect(markup).toContain('data-variant="default"')
    expect(classesOf(<Separator />)).toContain('bg-border')
  })

  // Why: a structural split (resizable panes) must read at 3:1, which the hairline does not.
  it('offers a strong divider drawn with the control border token', () => {
    const classes = classesOf(<Separator variant="strong" />)
    expect(classes).toContain('bg-control')
    expect(classes).not.toContain('bg-border')
  })

  it('keeps orientation sizing for both variants', () => {
    expect(classesOf(<Separator orientation="vertical" variant="strong" />)).toEqual(
      expect.arrayContaining([
        'data-[orientation=vertical]:w-px',
        'data-[orientation=horizontal]:h-px'
      ])
    )
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Toggle } from './toggle'

describe('Toggle', () => {
  // Why: bg-accent alone is 1.19:1 on cards, so a selected segment was hard to find in dark mode;
  // the selected fill plus a control-border inset ring (3:1 or more) marks it without colour alone,
  // and inset-ring uses its own shadow channel so it never hides the focus ring.
  it('outlines the selected state without competing with the focus ring', () => {
    const markup = renderToStaticMarkup(<Toggle pressed>Hide</Toggle>)
    const classes = (/class="([^"]*)"/.exec(markup)?.[1] ?? '').split(/\s+/)
    expect(classes).toEqual(
      expect.arrayContaining([
        'data-[state=on]:bg-selected',
        'data-[state=on]:text-selected-foreground',
        'data-[state=on]:inset-ring-1',
        'data-[state=on]:inset-ring-control',
        'focus-visible:ring-2',
        'focus-visible:ring-ring'
      ])
    )
    expect(classes.some((name) => name.startsWith('data-[state=on]:ring-'))).toBe(false)
  })

  it('hovers with the hover token', () => {
    const markup = renderToStaticMarkup(<Toggle>Hide</Toggle>)
    expect(markup).toContain('hover:bg-hover')
  })
})

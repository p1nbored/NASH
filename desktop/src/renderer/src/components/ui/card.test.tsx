import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Card, CardContent, CardHeader } from './card'

function classesOf(element: React.JSX.Element): string[] {
  const markup = renderToStaticMarkup(element)
  return (/class="([^"]*)"/.exec(markup)?.[1] ?? '').split(/\s+/)
}

// Why (D12): cards are flat paper panels with a hairline edge; dense settings need tight padding.
describe('Card', () => {
  it('is a flat panel with the panel radius and a hairline border', () => {
    const classes = classesOf(<Card />)
    expect(classes).toEqual(
      expect.arrayContaining(['rounded-lg', 'border', 'border-border', 'bg-card', 'py-4', 'gap-4'])
    )
    expect(classes.some((name) => name.startsWith('shadow'))).toBe(false)
    expect(classes).not.toContain('rounded-xl')
    expect(classes).not.toContain('border-border/50')
  })

  it('pads its header and content to the same 16px inset', () => {
    expect(classesOf(<CardHeader />)).toContain('px-4')
    expect(classesOf(<CardContent />)).toContain('px-4')
  })

  it('still lets callers override padding', () => {
    expect(classesOf(<Card className="gap-0 py-0" />)).toEqual(
      expect.arrayContaining(['gap-0', 'py-0'])
    )
    expect(classesOf(<Card className="gap-0 py-0" />)).not.toContain('py-4')
  })
})

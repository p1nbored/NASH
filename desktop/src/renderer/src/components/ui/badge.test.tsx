import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'

function classesOf(element: React.JSX.Element): string[] {
  const markup = renderToStaticMarkup(element)
  return (/class="([^"]*)"/.exec(markup)?.[1] ?? '').split(/\s+/)
}

describe('Badge', () => {
  // Why (D12): status chips are 4px chips, not pills; a pill is reserved for counts.
  it.each([
    'default',
    'secondary',
    'dot',
    'destructive',
    'outline',
    'ghost',
    'link',
    'hostContext',
    'success',
    'warning',
    'error'
  ] as const)('renders the %s variant as a 4px chip', (variant) => {
    const classes = classesOf(<Badge variant={variant}>Ready</Badge>)
    expect(classes).toContain('rounded-sm')
    expect(classes).not.toContain('rounded-full')
  })

  it('keeps the pill shape for counters only', () => {
    const classes = classesOf(<Badge variant="counter">3</Badge>)
    expect(classes).toEqual(expect.arrayContaining(['rounded-full', 'tabular-nums']))
  })

  it.each([
    ['success', 'status-success'],
    ['warning', 'status-warning'],
    ['error', 'status-error']
  ] as const)('tints the %s chip with its status family', (variant, family) => {
    expect(classesOf(<Badge variant={variant}>State</Badge>)).toEqual(
      expect.arrayContaining([
        `text-${family}`,
        `bg-${family}-background`,
        `border-${family}-border`
      ])
    )
  })

  it('draws a solid focus ring rather than a translucent halo', () => {
    const classes = classesOf(<Badge>Go</Badge>)
    expect(classes).toEqual(
      expect.arrayContaining(['focus-visible:ring-2', 'focus-visible:ring-ring'])
    )
    expect(classes.some((name) => /ring-(ring|destructive)\/\d+$/.test(name))).toBe(false)
  })

  it('uses token foregrounds instead of raw white text', () => {
    expect(classesOf(<Badge variant="destructive">Failed</Badge>)).toContain(
      'text-destructive-foreground'
    )
  })
})

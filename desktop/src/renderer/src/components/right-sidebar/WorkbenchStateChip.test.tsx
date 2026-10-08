// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import WorkbenchStateChip, { type WorkbenchChipKind } from './WorkbenchStateChip'

const KINDS: readonly WorkbenchChipKind[] = [
  'progress',
  'running',
  'waiting',
  'permission',
  'blocked',
  'failed',
  'disconnected',
  'unknown',
  'done',
  'ended'
]

afterEach(cleanup)

function chipOf(label: string): HTMLElement {
  const chip = screen.getByText(label).closest<HTMLElement>('[data-slot="badge"]')
  if (!chip) {
    throw new Error(`no chip for ${label}`)
  }
  return chip
}

describe('WorkbenchStateChip', () => {
  it('gives every kind a hidden icon of its own next to a visible label', () => {
    const icons = new Set<string>()
    for (const kind of KINDS) {
      const { unmount } = render(<WorkbenchStateChip kind={kind} label={`Label ${kind}`} />)
      const icon = chipOf(`Label ${kind}`).querySelector('svg')
      expect(icon?.getAttribute('aria-hidden')).toBe('true')
      icons.add(icon?.getAttribute('class') ?? '')
      unmount()
    }
    expect(icons.size).toBe(KINDS.length)
  })

  it('uses the Badge status chips only for states that need attention', () => {
    const variants = Object.fromEntries(
      KINDS.map((kind) => {
        const { unmount } = render(<WorkbenchStateChip kind={kind} label={kind} />)
        const chip = chipOf(kind)
        const entry = [kind, `${chip.dataset.variant}/${chip.dataset.tone}`]
        unmount()
        return entry
      })
    )
    expect(variants).toEqual({
      progress: 'ghost/quiet',
      running: 'ghost/plain',
      waiting: 'warning/warning',
      permission: 'warning/warning',
      blocked: 'warning/warning',
      failed: 'error/error',
      disconnected: 'warning/warning',
      unknown: 'ghost/quiet',
      done: 'ghost/success',
      ended: 'ghost/quiet'
    })
  })

  it('keeps the 4px badge shape and token colours', () => {
    render(<WorkbenchStateChip kind="failed" label="Failed" />)
    const classes = chipOf('Failed').className
    expect(classes).toContain('rounded-sm')
    expect(classes).toContain('bg-status-error-background')
    expect(classes).not.toMatch(/rounded-full|text-\[|#[0-9a-f]{3}/)
  })
})

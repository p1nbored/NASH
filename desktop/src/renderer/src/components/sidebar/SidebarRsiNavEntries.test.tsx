// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ rsiNavigation: false }))

vi.mock('../../../../shared/nash-build-flags', () => ({
  get RSI_NAVIGATION_ENABLED() {
    return flags.rsiNavigation
  }
}))

import type * as NashBuildFlags from '../../../../shared/nash-build-flags'
import { SidebarRsiNavEntries } from './SidebarRsiNavEntries'

describe('SidebarRsiNavEntries (D-038)', () => {
  afterEach(() => {
    cleanup()
    flags.rsiNavigation = false
  })

  it('renders nothing while the RSI navigation flag is off, as it is in NASH builds', async () => {
    const actual = await vi.importActual<typeof NashBuildFlags>(
      '../../../../shared/nash-build-flags'
    )
    expect(actual.RSI_NAVIGATION_ENABLED).toBe(false)
    const { container } = render(<SidebarRsiNavEntries />)

    expect(container.innerHTML).toBe('')
  })

  it('shows only not-connected rows, without data or a destination, when the flag is on', () => {
    flags.rsiNavigation = true
    const { container } = render(<SidebarRsiNavEntries />)

    const rows = Array.from(container.querySelectorAll('button'))
    expect(rows.map((row) => row.getAttribute('data-rsi-nav-entry'))).toEqual([
      'rsi-lab',
      'rsi-improvements'
    ])
    for (const row of rows) {
      expect(row.disabled).toBe(true)
      expect(row.textContent).toContain('Not connected')
    }
    expect(rows[0]?.textContent).toContain('RSI Lab')
    expect(rows[1]?.textContent).toContain('Improvements')
  })
})

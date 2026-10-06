// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import { MobileRelayBetaNotice } from './MobileRelayBetaNotice'

afterEach(cleanup)

describe('MobileRelayBetaNotice in NASH builds (Orca cloud services off)', () => {
  it('says Relay and mobile push are not available instead of calling Relay a beta', () => {
    render(<MobileRelayBetaNotice />)

    expect(
      screen.getByText('Orca Relay and mobile push notifications are not available in NASH builds.')
    ).toBeInTheDocument()
    expect(screen.queryByText('Orca Relay is in beta.')).toBeNull()
  })
})

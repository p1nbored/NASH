// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../store'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'

// FIXTURE_ONLY: a host that keeps Orca's usage meters off (NASH).
const refreshGrokRateLimits = vi.hoisted(() => vi.fn())
const mockStoreState = {
  rateLimits: createEmptyRateLimitState({ usageMetersDisabled: true }),
  refreshGrokRateLimits,
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn(),
  recordFeatureInteraction: vi.fn()
} satisfies Partial<AppState>

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: Partial<AppState>) => unknown) => selector(mockStoreState)
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { GrokUsagePane } from './GrokUsagePane'

describe('GrokUsagePane with the usage meters off', () => {
  afterEach(() => cleanup())

  it('says usage is not shown, offers no refresh or setup, and reads nothing', () => {
    render(<GrokUsagePane />)
    expect(screen.getByText('Usage is not shown in NASH')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(refreshGrokRateLimits).not.toHaveBeenCalled()
  })
})

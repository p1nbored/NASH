// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAppUpdateFeed } from '../../../../shared/app-update-feed'
import type { UpdateStatus } from '../../../../shared/update-status-types'
import { useAppStore } from '../../store'
import { GeneralUpdateSettingsSection } from './GeneralUpdateSettingsSection'

vi.mock('./GeneralRemoteServerUpdates', () => ({ GeneralRemoteServerUpdates: () => null }))
vi.mock('./ReleaseChannelSection', () => ({
  ReleaseChannelSection: () => <div>release channel switcher</div>
}))

const check = vi.fn()

function renderWith(updateStatus: UpdateStatus): void {
  useAppStore.setState({ updateStatus })
  render(<GeneralUpdateSettingsSection />)
}

beforeEach(() => {
  check.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      updater: { check, download: vi.fn(), getVersion: vi.fn().mockResolvedValue('1.4.199') }
    }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ updateStatus: { state: 'idle' } })
})

// Why: this build has no release feed (D-017), so main never checks and the panel must not imply it does.
it('uses an explicitly disabled feed', () => {
  expect(getAppUpdateFeed()).toBeNull()
})

it('says updates are not available instead of promising an automatic check', () => {
  renderWith({ state: 'idle' })

  expect(screen.getByText('Updates are not available in this build.')).toBeTruthy()
  expect(screen.queryByText('Updates are checked automatically on launch.')).toBeNull()
  const button = screen.getByRole('button', { name: 'Check for Updates' })
  expect(button.hasAttribute('disabled')).toBe(true)
})

it('renders no release-notes link or download action without a feed', () => {
  renderWith({ state: 'available', version: '1.4.200', changelog: null })

  expect(screen.queryByRole('link', { name: 'Release notes' })).toBeNull()
  expect(screen.queryByRole('button', { name: /Download Update/ })).toBeNull()
  expect(screen.getByText('Updates are not available in this build.')).toBeTruthy()
})

// Why: the hidden channel switcher lists builds and checks for updates, which a feed-less build cannot do.
it('keeps the alt-click release channel switcher closed without a feed', () => {
  renderWith({ state: 'idle' })

  fireEvent.click(screen.getByText('Updates'), { altKey: true })

  expect(screen.queryByText('release channel switcher')).toBeNull()
})

vi.mock('../../../../shared/app-identity-constants', async (importOriginal) => {
  const actual = await importOriginal<{ APP_IDENTITY: object }>()
  return { ...actual, APP_IDENTITY: { ...actual.APP_IDENTITY, updateFeed: null } }
})

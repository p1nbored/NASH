// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppUpdateFeed } from '../../../shared/app-update-feed'
import type { UpdateStatus } from '../../../shared/update-status-types'
import { useAppStore } from '../store'
import { UpdateCard } from './UpdateCard'
import { NotificationCardStack } from './NotificationCardStack'

const openUrl = vi.fn()

function renderStatus(updateStatus: UpdateStatus): void {
  useAppStore.setState({
    updateStatus,
    updateChangelog: null,
    dismissedUpdateVersion: null,
    updateCardCollapsed: false,
    updateReassuranceSeen: true
  })
  render(
    <NotificationCardStack>
      <UpdateCard />
    </NotificationCardStack>
  )
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  openUrl.mockReset()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      shell: { openUrl },
      ui: { set: vi.fn().mockResolvedValue(undefined) },
      updater: {
        check: vi.fn(),
        dismissNudge: vi.fn(),
        dismissAvailableUpdate: vi.fn().mockResolvedValue(undefined),
        download: vi.fn(),
        quitAndInstall: vi.fn().mockResolvedValue(undefined)
      }
    }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

// Why: this build has no release feed (D-017), so there are no release notes to link.
describe('UpdateCard without a release feed', () => {
  it('runs against the shipped identity, which has no feed', () => {
    expect(getAppUpdateFeed()).toBeNull()
  })

  it('shows no release-notes link while an update downloads', () => {
    renderStatus({ state: 'downloading', percent: 40, version: '1.4.200' })

    expect(screen.getByText(/is downloading/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Release notes' })).toBeNull()
  })

  it('shows no release-notes link for an available update', () => {
    renderStatus({ state: 'available', version: '1.4.200', changelog: null })

    expect(screen.queryByRole('button', { name: 'Release notes' })).toBeNull()
  })

  it('offers no official-releases link on a security stop', () => {
    renderStatus({ state: 'available', version: '1.4.200', changelog: null })
    const message =
      'New version 1.4.200 is not signed by the application owner: publisherNames: NASH'

    act(() => useAppStore.getState().setUpdateStatus({ state: 'error', message }))

    expect(screen.getByText("Update Wasn't Installed")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check official releases' })).toBeNull()
    expect(openUrl).not.toHaveBeenCalled()
  })
})

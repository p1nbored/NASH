import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { openExternalMock } = vi.hoisted(() => ({ openExternalMock: vi.fn() }))

vi.mock('electron', () => ({ shell: { openExternal: openExternalMock } }))

import { openNotificationSystemSettings } from './notification-system-settings-link'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value })
}

beforeEach(() => {
  openExternalMock.mockReset()
  openExternalMock.mockResolvedValue(undefined)
})

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.unstubAllEnvs()
})

// D-017: the notification settings pane opened for this app must be NASH's, never a real Orca install's.
describe('openNotificationSystemSettings', () => {
  it('opens the macOS notification settings for the NASH bundle id', () => {
    vi.stubEnv('ORCA_DEV_MACOS_BUNDLE_ID', undefined)
    setPlatform('darwin')

    openNotificationSystemSettings()

    expect(openExternalMock).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.pinbored.nash'
    )
  })

  it('never names a real Orca bundle id', () => {
    vi.stubEnv('ORCA_DEV_MACOS_BUNDLE_ID', undefined)
    setPlatform('darwin')

    openNotificationSystemSettings()

    expect(String(openExternalMock.mock.calls[0]?.[0])).not.toContain('stablyai')
  })

  it('lets a dev launch name its own wrapper bundle id', () => {
    vi.stubEnv('ORCA_DEV_MACOS_BUNDLE_ID', 'com.pinbored.nash.dev.abc123')
    setPlatform('darwin')

    openNotificationSystemSettings()

    expect(openExternalMock).toHaveBeenCalledWith(
      expect.stringContaining('id=com.pinbored.nash.dev.abc123')
    )
  })

  it('opens the Windows notification settings page on Windows', () => {
    setPlatform('win32')

    openNotificationSystemSettings()

    expect(openExternalMock).toHaveBeenCalledWith('ms-settings:notifications')
  })
})

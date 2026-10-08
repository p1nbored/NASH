import { describe, expect, it } from 'vitest'
import { getUnpairedDeviceToastRecovery } from './unpaired-device-toast-recovery'

describe('unpaired device toast recovery', () => {
  it('sends the user to Remote NASH Servers while Orca Mobile is hidden', () => {
    const recovery = getUnpairedDeviceToastRecovery(false)

    expect(recovery.pane).toBe('servers')
    expect(recovery.actionLabel).toBe('Open Server Settings')
    expect(recovery.description).not.toMatch(/phone|mobile/i)
  })

  it('keeps the Mobile settings recovery when Orca Mobile is shown', () => {
    const recovery = getUnpairedDeviceToastRecovery(true)

    expect(recovery.pane).toBe('mobile')
    expect(recovery.actionLabel).toBe('Open Mobile Settings')
  })
})

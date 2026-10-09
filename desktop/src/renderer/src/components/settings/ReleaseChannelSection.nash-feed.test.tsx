// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { ReleaseChannelSection } from './ReleaseChannelSection'

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

it('offers only published NASH channels and falls back from a saved development channel', async () => {
  const listBuilds = vi.fn().mockResolvedValue({ ok: true, builds: [] })
  useAppStore.setState({ releaseChannelOverride: 'hourly', updateStatus: { state: 'idle' } })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { updater: { getVersion: vi.fn().mockResolvedValue('1.4.217'), listBuilds } }
  })
  render(<ReleaseChannelSection />)
  await waitFor(() => expect(listBuilds).toHaveBeenCalledWith('stable', undefined))
  expect(screen.getByRole('radio', { name: 'Stable' })).toBeTruthy()
  expect(screen.getByRole('radio', { name: 'RC' })).toBeTruthy()
  for (const name of ['Hourly', 'Daily', 'Adhoc']) {
    expect(screen.queryByRole('radio', { name })).toBeNull()
  }
})

// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyDetailsButton } from './settings-copy-details-button'
import { SettingsStatusLabel } from './settings-status-label'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const clipboard = vi.fn<(text: string) => Promise<void>>()

describe('CopyDetailsButton', () => {
  beforeEach(() => {
    clipboard.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
    Object.assign(window, { api: { ui: { writeClipboardText: clipboard } } })
  })

  afterEach(() => {
    cleanup()
  })

  it('builds the details only when clicked, copies them and confirms with a toast', async () => {
    clipboard.mockResolvedValue(undefined)
    const build = vi.fn(() => 'reason: fixture_code')
    render(<CopyDetailsButton details={build} />)

    expect(build).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('fixture_code')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    })

    expect(clipboard).toHaveBeenCalledWith('reason: fixture_code')
    expect(toast.success).toHaveBeenCalledWith('Details copied.')
  })

  it('redacts secrets supplied by a diagnostic callback before copying', async () => {
    clipboard.mockResolvedValue(undefined)
    render(
      <CopyDetailsButton
        details={() => 'error: Bearer abc123 ANTHROPIC_AUTH_TOKEN=private-value'}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    })
    expect(clipboard).toHaveBeenCalledWith(
      'error: [redacted-secret] ANTHROPIC_AUTH_TOKEN=[redacted]'
    )
  })

  it('says when the details could not be copied', async () => {
    clipboard.mockRejectedValue(new Error('denied'))
    render(<CopyDetailsButton details="reason: fixture_code" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    })

    expect(toast.error).toHaveBeenCalledWith('The details could not be copied.')
  })
})

describe('SettingsStatusLabel', () => {
  afterEach(() => {
    cleanup()
  })

  it('pairs every tone with an icon and a text label instead of a pill', () => {
    for (const tone of ['success', 'warning', 'error', 'neutral', 'busy'] as const) {
      const { container } = render(<SettingsStatusLabel tone={tone} label={`Label ${tone}`} />)
      const label = container.querySelector(`[data-status-tone="${tone}"]`)
      expect(label?.querySelector('svg')).not.toBeNull()
      expect(label?.textContent).toBe(`Label ${tone}`)
      expect(label?.className).not.toMatch(/rounded-full|border/)
      cleanup()
    }
  })
})

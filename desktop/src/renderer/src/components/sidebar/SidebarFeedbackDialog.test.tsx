// @vitest-environment happy-dom

import React, { act, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  getVersion: vi.fn(),
  readFeedbackImageFiles: vi.fn(),
  submit: vi.fn(),
  toastWarning: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: mocks.toastWarning
  }
}))

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await import('react')
  const Section = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Dialog: ({ children }: { children?: ReactNode }) => <>{children}</>,
    DialogContent: ReactModule.forwardRef<
      HTMLDivElement,
      React.HTMLAttributes<HTMLDivElement> & {
        children?: ReactNode
        onOpenAutoFocus?: (event: Event) => void
      }
    >(function DialogContent({ children, onOpenAutoFocus: _onOpenAutoFocus, ...props }, ref) {
      return (
        <div ref={ref} {...props}>
          {children}
        </div>
      )
    }),
    DialogDescription: Section,
    DialogFooter: Section,
    DialogHeader: Section,
    DialogTitle: Section
  }
})

vi.mock('@/lib/feedback-image-attachments', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    readFeedbackImageFiles: mocks.readFeedbackImageFiles
  }
})

import { SidebarFeedbackDialog } from './SidebarFeedbackDialog'
import { useAppStore } from '@/store'

beforeEach(() => {
  mocks.readFeedbackImageFiles.mockReset()
  mocks.submit.mockReset()
  mocks.toastWarning.mockReset()
  mocks.getPlatform.mockReset()
  mocks.getVersion.mockReset()
  mocks.submit.mockResolvedValue({ ok: true, issueOpened: true })
  mocks.getPlatform.mockReturnValue({
    platform: 'darwin',
    osRelease: '25.0.0',
    arch: 'arm64',
    shell: '/bin/zsh',
    displayServer: null
  })
  mocks.getVersion.mockResolvedValue('1.4.178-rc.2')
  URL.revokeObjectURL = vi.fn()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      feedback: { submit: mocks.submit },
      ui: { writeClipboardText: vi.fn().mockResolvedValue(undefined) },
      gh: { viewer: vi.fn().mockResolvedValue(null) },
      shell: { openUrl: vi.fn() },
      platform: {
        get: mocks.getPlatform
      },
      updater: { getVersion: mocks.getVersion }
    }
  })
})

afterEach(() => {
  cleanup()
  // Why: the draft outlives the dialog on purpose now, so it also outlives a
  // test unless each one starts from an empty store.
  useAppStore.getState().clearFeedbackDraft()
})

describe('SidebarFeedbackDialog environment prefill', () => {
  it('copies the complete draft through the native clipboard API', () => {
    const draft = 'A detailed report. '.repeat(500)
    useAppStore.getState().setFeedbackDraft({ feedback: draft })
    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy full draft' }))
    expect(window.api.ui.writeClipboardText).toHaveBeenCalledWith(draft)
  })
  it('keeps the draft after opening GitHub and leaves attachments and identity to the browser', async () => {
    useAppStore.getState().setFeedbackDraft({ feedback: 'A reproducible bug' })
    const onOpenChange = vi.fn()
    render(<SidebarFeedbackDialog open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open GitHub Issue' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(useAppStore.getState().feedbackDraft.feedback).toContain('A reproducible bug')
    expect(window.api.gh.viewer).not.toHaveBeenCalled()
    expect(mocks.submit.mock.calls[0]?.[0]).not.toHaveProperty('images')
    expect(screen.queryByText('Submit anonymously')).toBeNull()
    expect(screen.queryByText('Attach')).toBeNull()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('retains the draft and dialog when the browser cannot open', async () => {
    mocks.submit.mockResolvedValue({ ok: false, error: 'Browser unavailable' })
    useAppStore.getState().setFeedbackDraft({ feedback: 'Keep this report' })
    const onOpenChange = vi.fn()
    render(<SidebarFeedbackDialog open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open GitHub Issue' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(useAppStore.getState().feedbackDraft.feedback).toContain('Keep this report')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
  it('pre-inserts Orca version and OS info when the dialog opens', async () => {
    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>('What could we improve?')

    await waitFor(() => {
      expect(textarea.value).toContain('NASH: 1.4.178-rc.2')
      expect(textarea.value).toContain('OS: darwin 25.0.0 (arm64)')
      expect(textarea.value).toContain('Shell: /bin/zsh')
    })
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Open GitHub Issue' }).disabled
    ).toBe(true)
  })

  it('keeps version info when the user types above the prefilled block', async () => {
    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>('What could we improve?')
    await waitFor(() => expect(textarea.value).toContain('NASH: 1.4.178-rc.2'))

    fireEvent.change(textarea, {
      target: { value: `Tabs feel slow\n\n${textarea.value.trim()}` }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open GitHub Issue' }))

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    const submitted = String(mocks.submit.mock.calls[0]?.[0].feedback)
    expect(submitted).toContain('Tabs feel slow')
    expect(submitted).toContain('NASH: 1.4.178-rc.2')
  })

  it('preserves early typing and appends the footer after version loading finishes', async () => {
    let finishVersion: ((version: string) => void) | undefined
    mocks.getVersion.mockReturnValue(
      new Promise((resolve) => {
        finishVersion = resolve
      })
    )
    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>('What could we improve?')

    fireEvent.change(textarea, { target: { value: 'Typed before loading' } })
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    await act(async () => finishVersion?.('1.4.178-rc.2'))

    await waitFor(() => expect(textarea.value).toContain('NASH: 1.4.178-rc.2'))
    expect(textarea.value).toContain('Typed before loading')
    expect(textarea.selectionStart).toBe('Typed before loading'.length)
  })

  it('enables Send when the user types below the prefilled footer', async () => {
    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>('What could we improve?')
    await waitFor(() => expect(textarea.value).toContain('NASH: 1.4.178-rc.2'))

    fireEvent.change(textarea, {
      target: { value: `${textarea.value.trim()}\nText below footer` }
    })

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Open GitHub Issue' }).disabled
    ).toBe(false)
  })

  it('keeps Send disabled for an edited footer with no user text', async () => {
    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>('What could we improve?')
    await waitFor(() => expect(textarea.value).toContain('NASH: 1.4.178-rc.2'))

    fireEvent.change(textarea, {
      target: { value: '---\nNASH: custom build\nOS: edited' }
    })

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Open GitHub Issue' }).disabled
    ).toBe(true)
  })

  it('allows a real report after the prefilled footer is deleted', async () => {
    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>('What could we improve?')
    await waitFor(() => expect(textarea.value).toContain('NASH: 1.4.178-rc.2'))
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Open GitHub Issue' })

    fireEvent.change(textarea, { target: { value: '' } })
    expect(send.disabled).toBe(true)
    fireEvent.change(textarea, { target: { value: 'Tabs hang after waking the laptop.' } })
    expect(send.disabled).toBe(false)
  })

  it('still prefills best-effort details when preload lookups fail', async () => {
    mocks.getPlatform.mockImplementation(() => {
      throw new Error('platform unavailable')
    })
    mocks.getVersion.mockRejectedValue(new Error('version unavailable'))

    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>('What could we improve?')
      expect(textarea.value).toContain('NASH: unknown')
    })
  })
})

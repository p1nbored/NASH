// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrashReportRecord } from '../../../../shared/crash-reporting'
import { CrashReportDialogSurface } from './CrashReportDialogSurface'

const viewer = vi.fn(async () => null)
const submit = vi.fn()
const successToast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { success: successToast, error: vi.fn() } }))

vi.mock('./use-crash-report-copy', () => ({
  useCrashReportCopy: () => vi.fn(async () => {})
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>
}))

function crashReport(): CrashReportRecord {
  return {
    id: 'crash-1',
    createdAt: '2026-08-10T00:00:00.000Z',
    status: 'pending',
    source: 'renderer',
    processType: 'renderer',
    reason: 'crashed',
    exitCode: 5,
    appVersion: '1.0.0',
    platform: 'win32',
    osRelease: 'test',
    arch: 'x64',
    electronVersion: '41',
    chromeVersion: '141',
    details: { error: 'boom' }
  }
}

function renderSurface(report: CrashReportRecord | null): void {
  render(
    <CrashReportDialogSurface
      open
      report={report}
      loading={false}
      onOpenChange={() => {}}
      onReportChange={() => {}}
    />
  )
}

beforeEach(() => {
  viewer.mockClear()
  submit.mockReset()
  successToast.mockClear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { gh: { viewer }, crashReports: { submit, dismiss: vi.fn(async () => {}) } }
  })
})

afterEach(() => cleanup())

describe('CrashReportDialogSurface in NASH builds (Orca cloud services off)', () => {
  it('offers a GitHub issue form without cloud upload or account lookup', () => {
    renderSurface(crashReport())

    expect(screen.getByRole('button', { name: /Open GitHub Issue/ })).toBeInTheDocument()
    expect(screen.queryByText('Attach recent diagnostic logs')).toBeNull()
    expect(
      screen.getByText(
        'Review and submit a crash report on GitHub. Copy Details includes the full diagnostic text.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy Details/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(viewer).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('offers a GitHub issue form when no automatic report was captured', () => {
    renderSurface(null)

    expect(screen.getByText('No automatic crash report was captured.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Send Report/ })).toBeNull()
    expect(viewer).not.toHaveBeenCalled()
  })
  it('opens a draft with notes and reports browser opening rather than submission', async () => {
    const report = crashReport()
    submit.mockResolvedValue({ ok: true, issueOpened: true, report })
    const onReportChange = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <CrashReportDialogSurface
        open
        report={report}
        loading={false}
        onReportChange={onReportChange}
        onOpenChange={onOpenChange}
      />
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My notes' } })
    fireEvent.click(screen.getByRole('button', { name: /Open GitHub Issue/ }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(submit).toHaveBeenCalledWith({ reportId: report.id, notes: 'My notes' })
    expect(onReportChange).toHaveBeenCalledWith(report)
    expect(successToast).toHaveBeenCalledWith(
      'GitHub issue form opened. Submit the report in your browser.'
    )
  })

  it('keeps notes and the dialog available when opening GitHub fails', async () => {
    submit.mockResolvedValue({ ok: false, error: 'Browser unavailable' })
    const onOpenChange = vi.fn()
    render(
      <CrashReportDialogSurface
        open
        report={null}
        loading={false}
        onReportChange={vi.fn()}
        onOpenChange={onOpenChange}
      />
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep these notes' } })
    fireEvent.click(screen.getByRole('button', { name: /Open GitHub Issue/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Open GitHub Issue/ })).toBeEnabled()
    )
    expect(screen.getByRole('textbox')).toHaveValue('Keep these notes')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(successToast).not.toHaveBeenCalled()
  })
})

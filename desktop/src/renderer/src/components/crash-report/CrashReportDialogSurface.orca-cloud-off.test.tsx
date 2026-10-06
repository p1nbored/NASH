// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrashReportRecord } from '../../../../shared/crash-reporting'
import { CrashReportDialogSurface } from './CrashReportDialogSurface'

const viewer = vi.fn(async () => null)
const submit = vi.fn()

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
  submit.mockClear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { gh: { viewer }, crashReports: { submit, dismiss: vi.fn(async () => {}) } }
  })
})

afterEach(() => cleanup())

describe('CrashReportDialogSurface in NASH builds (Orca cloud services off)', () => {
  it('offers no Send button and says crash reports are not sent', () => {
    renderSurface(crashReport())

    expect(screen.queryByRole('button', { name: /Send Report/ })).toBeNull()
    expect(screen.queryByText('Attach recent diagnostic logs')).toBeNull()
    expect(
      screen.getByText('NASH does not send crash reports. Copy the details to keep them.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy Details/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(viewer).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('offers no sending when no automatic report was captured', () => {
    renderSurface(null)

    expect(screen.getByText('No automatic crash report was captured.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Send Report/ })).toBeNull()
    expect(viewer).not.toHaveBeenCalled()
  })
})

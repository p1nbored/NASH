import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrashReportRecord } from '../../shared/crash-reporting'
import { CrashReportStore } from '../crash-reporting/crash-report-store'

vi.mock('../crash-reporting/crash-report-store')

const {
  handlers,
  listeners,
  clipboardWriteTextMock,
  collectDiagnosticBundleMock,
  getDiagnosticsStatusMock,
  recordCrashBreadcrumbMock,
  resolveDiagnosticOrcaChannelMock,
  spanEndMock,
  startSpanMock,
  submitFeedbackMock,
  openExternalMock
} = vi.hoisted(() => {
  const spanEndMock = vi.fn()
  return {
    handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
    listeners: new Map<string, (_event: unknown, args?: unknown) => void>(),
    clipboardWriteTextMock: vi.fn(),
    collectDiagnosticBundleMock: vi.fn(),
    getDiagnosticsStatusMock: vi.fn(),
    recordCrashBreadcrumbMock: vi.fn(),
    resolveDiagnosticOrcaChannelMock: vi.fn(),
    spanEndMock,
    startSpanMock: vi.fn(() => ({
      traceId: 'trace-id',
      spanId: 'span-id',
      setAttribute: vi.fn(),
      addEvent: vi.fn(),
      fail: vi.fn(),
      interrupt: vi.fn(),
      end: spanEndMock
    })),
    openExternalMock: vi.fn(),
    submitFeedbackMock: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3-test' },
  shell: { openExternal: openExternalMock },
  clipboard: { writeText: clipboardWriteTextMock },
  ipcMain: {
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeAllListeners: vi.fn((channel: string) => listeners.delete(channel)),
    on: vi.fn((channel: string, listener: (_event: unknown, args?: unknown) => void) => {
      listeners.set(channel, listener)
    })
  }
}))

vi.mock('./feedback', () => ({
  submitFeedback: submitFeedbackMock
}))

vi.mock('../crash-reporting/crash-breadcrumb-store', () => ({
  getCrashBreadcrumbSnapshot: vi.fn(() => []),
  // Renderer breadcrumb routing is covered in crash-reporting-renderer-breadcrumbs.test.ts.
  recordCoalescedCrashBreadcrumb: vi.fn(),
  recordCrashBreadcrumb: (...args: unknown[]) => recordCrashBreadcrumbMock(...args)
}))

vi.mock('../observability', () => ({
  collectDiagnosticBundle: collectDiagnosticBundleMock,
  getDiagnosticsStatus: getDiagnosticsStatusMock
}))

vi.mock('../observability/diagnostic-upload-endpoint', () => ({
  resolveDiagnosticOrcaChannel: resolveDiagnosticOrcaChannelMock
}))

vi.mock('../observability/tracer', () => ({
  startSpan: startSpanMock
}))

import {
  _resetRendererErrorReportDedupeForTests,
  registerCrashReportingHandlers
} from './crash-reporting'

function diagnosticBundle(): ReturnType<typeof collectDiagnosticBundleMock> {
  return {
    bundleSubmissionId: 'bundleabcdefghijklmnop',
    payload: '{"type":"bundle-header"}\n',
    bytes: 25,
    spanCount: 1
  }
}

function report(
  status: CrashReportRecord['status'] = 'pending',
  id = 'crash-1'
): CrashReportRecord {
  return {
    id,
    createdAt: '2026-05-16T01:00:00.000Z',
    status,
    source: 'renderer',
    processType: 'renderer',
    reason: 'crashed',
    exitCode: 5,
    appVersion: '1.0.0',
    platform: process.platform,
    osRelease: 'test',
    arch: process.arch,
    electronVersion: '41',
    chromeVersion: '141',
    details: {}
  }
}

function registerHandlers(overrides: Partial<CrashReportStore>): void {
  const store = Object.assign(new CrashReportStore('fixture-crash-reports.json'), overrides)
  registerCrashReportingHandlers(store)
}

describe('registerCrashReportingHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    listeners.clear()
    clipboardWriteTextMock.mockReset()
    collectDiagnosticBundleMock.mockReset()
    collectDiagnosticBundleMock.mockReturnValue(diagnosticBundle())
    getDiagnosticsStatusMock.mockReset()
    getDiagnosticsStatusMock.mockReturnValue({
      localFileEnabled: true,
      otlpEnabled: false,
      bundleEnabled: true,
      otlpStatus: 'Disabled',
      traceFilePath: '/tmp/main.trace.ndjson',
      traceFamilySize: 25
    })
    resolveDiagnosticOrcaChannelMock.mockReset()
    resolveDiagnosticOrcaChannelMock.mockReturnValue('stable')
    startSpanMock.mockClear()
    spanEndMock.mockClear()
    openExternalMock.mockReset()
    openExternalMock.mockResolvedValue(undefined)
    submitFeedbackMock.mockReset()
    recordCrashBreadcrumbMock.mockReset()
    submitFeedbackMock.mockResolvedValue({ ok: true })
    _resetRendererErrorReportDedupeForTests()
  })

  it('copies the requested captured report to the clipboard', async () => {
    const latest = report()
    registerHandlers({
      getById: vi.fn(async () => latest),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [latest]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    })

    const result = await handlers.get('crashReports:copyLatestDiagnostics')?.(null, {
      reportId: latest.id,
      notes: 'extra /Users/alice/project'
    })

    expect(result).toEqual({ ok: true })
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('[Crash Report]'))
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      expect.stringContaining('extra [redacted-path]')
    )
  })

  it('copies an uncaptured crash report when the caller intentionally omits reportId', async () => {
    const pending = report('pending', 'crash-late-pending')
    const listRecent = vi.fn(async () => [pending])
    registerHandlers({
      getById: vi.fn(async () => null),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent,
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    })

    const result = await handlers.get('crashReports:copyLatestDiagnostics')?.(null, {
      notes: 'after opening /Users/alice/project'
    })

    expect(result).toEqual({ ok: true })
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('not captured'))
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('[redacted-path]'))
    expect(clipboardWriteTextMock).not.toHaveBeenCalledWith(
      expect.stringContaining('crash-late-pending')
    )
    expect(listRecent).not.toHaveBeenCalled()
  })

  it('copies sanitized submission and diagnostic omission failures for a captured report', async () => {
    const pending = report('pending', 'crash-copy-failure')
    registerHandlers({
      getById: vi.fn(async () => pending),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [pending]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    })

    const result = await handlers.get('crashReports:copyLatestDiagnostics')?.(null, {
      reportId: pending.id,
      notes: 'current notes',
      submissionFailure: {
        error: 'fallback failed at C:\\Users\\alice\\Orca',
        diagnosticContext: {
          status: 'not_uploaded',
          reason: 'attachment token=super-secret-value',
          internalEndpointError: 'must-not-cross-copy-boundary'
        },
        diagnosticBundleFailure: 'must-not-cross-copy-boundary'
      }
    })

    expect(result).toEqual({ ok: true })
    const copiedText = String(clipboardWriteTextMock.mock.calls[0]?.[0])
    expect(copiedText).toContain('Report ID: crash-copy-failure')
    expect(copiedText).toContain('Submission failure:')
    expect(copiedText).toContain('Report error: fallback failed at [redacted-path]')
    expect(copiedText).toContain('Diagnostic logs not uploaded: attachment token=[redacted]')
    expect(copiedText).not.toContain('alice')
    expect(copiedText).not.toContain('must-not-cross-copy-boundary')
  })

  it('returns dismissed unsent reports for the manual Help menu entry', async () => {
    const dismissed = report('dismissed', 'crash-help-menu')
    registerHandlers({
      getById: vi.fn(async () => dismissed),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [report('sent', 'crash-sent'), dismissed]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    })

    await expect(handlers.get('crashReports:getLatestPending')?.(null)).resolves.toBeNull()
    await expect(handlers.get('crashReports:getLatestReport')?.(null)).resolves.toEqual(dismissed)
  })

  it.each(['pending', 'dismissed'] as const)(
    'opens a GitHub draft for a %s report without marking it sent',
    async (status) => {
      const captured = report(status)
      const markSent = vi.fn()
      const markDismissedSent = vi.fn()
      registerHandlers({
        getById: vi.fn(async () => captured),
        listRecent: vi.fn(async () => [captured]),
        markSent,
        markDismissedSent,
        dismiss: vi.fn()
      })
      const result = await handlers.get('crashReports:submit')?.(null, {
        reportId: captured.id,
        notes: 'Crash at /Users/alice/project',
        includeDiagnosticLogs: true,
        githubLogin: 'ignored-user',
        githubEmail: 'ignored@example.com'
      })
      expect(result).toEqual({ ok: true, issueOpened: true, report: captured })
      const url = new URL(openExternalMock.mock.calls[0][0])
      expect(url.origin + url.pathname).toBe('https://github.com/p1nbored/NASH/issues/new')
      expect(url.searchParams.get('body')).toContain('Crash at [redacted-path]')
      expect(url.searchParams.get('body')).not.toContain('ignored@example.com')
      expect(markSent).not.toHaveBeenCalled()
      expect(markDismissedSent).not.toHaveBeenCalled()
      expect(submitFeedbackMock).not.toHaveBeenCalled()
      expect(collectDiagnosticBundleMock).not.toHaveBeenCalled()
    }
  )

  it('opens an uncaptured crash draft with notes and app details', async () => {
    registerHandlers({ listRecent: vi.fn(async () => []) })
    expect(await handlers.get('crashReports:submit')?.(null, { notes: 'Startup crash' })).toEqual({
      ok: true,
      issueOpened: true,
      report: null
    })
    const body = new URL(openExternalMock.mock.calls[0][0]).searchParams.get('body')
    expect(body).toContain('Report ID: not captured')
    expect(body).toContain('Startup crash')
    expect(body).toContain('1.2.3-test')
    expect(collectDiagnosticBundleMock).not.toHaveBeenCalled()
  })

  it('dismisses a pending report locally without any network submission', async () => {
    const latest = report('pending', 'crash-dismiss')
    const dismissed = report('dismissed', latest.id)
    const dismiss = vi.fn(async () => dismissed)
    registerHandlers({
      getById: vi.fn(async () => latest),
      dismiss,
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [latest]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    })

    const result = await handlers.get('crashReports:dismiss')?.(null, {
      reportId: latest.id
    })

    expect(result).toEqual(dismissed)
    expect(dismiss).toHaveBeenCalledWith(latest.id)
    expect(submitFeedbackMock).not.toHaveBeenCalled()
  })

  it('keeps the report available and sanitizes browser launch failure', async () => {
    const captured = report()
    const markSent = vi.fn()
    openExternalMock.mockRejectedValueOnce(new Error('secret internal URL'))
    registerHandlers({ getById: vi.fn(async () => captured), markSent })
    expect(await handlers.get('crashReports:submit')?.(null, { reportId: captured.id })).toEqual({
      ok: false,
      status: null,
      error: 'Could not open GitHub. Copy the details and try again.',
      report: captured
    })
    expect(markSent).not.toHaveBeenCalled()
  })

  it('prevents concurrent draft opens and permits retry after browser failure', async () => {
    const captured = report()
    let rejectOpen: (error: Error) => void = () => {}
    openExternalMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOpen = reject
        })
    )
    registerHandlers({ getById: vi.fn(async () => captured) })
    const submit = () => handlers.get('crashReports:submit')?.(null, { reportId: captured.id })
    const first = submit()
    await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledOnce())
    expect(await submit()).toMatchObject({
      ok: false,
      error: 'GitHub issue form is already opening.'
    })
    rejectOpen(new Error('launch failed'))
    await first
    expect(await submit()).toEqual({ ok: true, issueOpened: true, report: captured })
    expect(openExternalMock).toHaveBeenCalledTimes(2)
  })

  it('records a deduped renderer error boundary report through the crash store', async () => {
    const recorded = report('pending', 'react-render')
    const recordMock = vi.fn(async () => recorded)
    registerHandlers({
      getById: vi.fn(),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => []),
      record: recordMock,
      formatDiagnosticText: vi.fn()
    })

    const args = {
      boundaryId: 'terminal.workbench',
      surface: 'terminal-workbench',
      errorName: 'TypeError',
      errorMessage: 'Cannot read /Users/alice/project/token=abc123',
      errorStack: 'TypeError: nope\n    at /Users/alice/project/App.tsx:12:1',
      componentStack: 'at Terminal\nat App',
      activeView: 'terminal',
      activeModal: 'none',
      activeTabType: 'terminal',
      activeRightSidebarTab: 'source-control',
      hasActiveWorktree: true
    }

    await expect(handlers.get('crashReports:recordRendererError')?.(null, args)).resolves.toEqual({
      ok: true,
      report: recorded,
      deduped: false
    })
    await expect(handlers.get('crashReports:recordRendererError')?.(null, args)).resolves.toEqual({
      ok: true,
      report: null,
      deduped: true
    })

    expect(recordMock).toHaveBeenCalledTimes(1)
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'renderer',
        processType: 'react-render',
        reason: 'react-error-boundary',
        exitCode: null,
        appVersion: '1.2.3-test',
        details: expect.objectContaining({
          boundary_id: 'terminal.workbench',
          surface: 'terminal-workbench',
          error_name: 'TypeError',
          error_message: 'Cannot read /Users/alice/project/token=abc123',
          active_view: 'terminal',
          active_modal: 'none',
          active_tab_type: 'terminal',
          right_sidebar_tab: 'source-control',
          has_active_worktree: true
        })
      })
    )
  })

  it('rejects invalid renderer error boundary surfaces', async () => {
    const recordMock = vi.fn()
    registerHandlers({
      getById: vi.fn(),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => []),
      record: recordMock,
      formatDiagnosticText: vi.fn()
    })

    await expect(
      handlers.get('crashReports:recordRendererError')?.(null, {
        boundaryId: 'terminal.workbench',
        surface: 'unknown',
        errorName: 'TypeError',
        errorMessage: 'nope'
      })
    ).resolves.toEqual({ ok: false, error: 'Invalid renderer error report.' })
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('bounds renderer error dedupe keys by evicting the oldest unique reports', async () => {
    let recordCount = 0
    const recordMock = vi.fn(async () => report('pending', `react-render-${recordCount++}`))
    registerHandlers({
      getById: vi.fn(),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => []),
      record: recordMock,
      formatDiagnosticText: vi.fn()
    })

    const baseArgs = {
      boundaryId: 'terminal.workbench',
      surface: 'terminal-workbench',
      errorName: 'TypeError',
      componentStack: 'at Terminal'
    }

    for (let i = 0; i < 260; i += 1) {
      await handlers.get('crashReports:recordRendererError')?.(null, {
        ...baseArgs,
        errorMessage: `unique-render-error-${i}`
      })
    }

    await expect(
      handlers.get('crashReports:recordRendererError')?.(null, {
        ...baseArgs,
        errorMessage: 'unique-render-error-0'
      })
    ).resolves.toEqual({
      ok: true,
      report: expect.objectContaining({ id: 'react-render-260' }),
      deduped: false
    })
    await expect(
      handlers.get('crashReports:recordRendererError')?.(null, {
        ...baseArgs,
        errorMessage: 'unique-render-error-259'
      })
    ).resolves.toEqual({
      ok: true,
      report: null,
      deduped: true
    })

    expect(recordMock).toHaveBeenCalledTimes(261)
  })
})

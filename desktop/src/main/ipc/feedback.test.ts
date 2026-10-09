import { beforeEach, describe, expect, it, vi } from 'vitest'

// Report routing is independent of unrelated Orca cloud features.
vi.mock('../../shared/orca-cloud-services', () => ({ ORCA_CLOUD_SERVICES_ENABLED: true }))

const { fetchMock, openExternal, handlers } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3-test' },
  shell: { openExternal },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel))
  },
  net: { fetch: (...args: unknown[]) => fetchMock(...args) }
}))

import { registerFeedbackHandlers, submitFeedback } from './feedback'

const OPENED = { ok: true, issueOpened: true }

describe('feedback opens NASH GitHub issue drafts', () => {
  beforeEach(() => {
    handlers.clear()
    openExternal.mockClear()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
  })

  it('opens a NASH issue draft without uploading attachments or account identity', async () => {
    const result = await submitFeedback({
      feedback: 'private bug report',
      githubLogin: 'someone',
      githubEmail: 'someone@example.test',
      images: [{ contentType: 'image/png', data: new Uint8Array([1, 2, 3]) }]
    })

    expect(result).toEqual(OPENED)
    const url = new URL(openExternal.mock.calls[0]![0])
    expect(url.origin + url.pathname).toBe('https://github.com/p1nbored/NASH/issues/new')
    expect(url.searchParams.get('body')).toContain('private bug report')
    expect(url.href).not.toContain('someone')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens the crash text without uploading its diagnostic bundle', async () => {
    const result = await submitFeedback({
      feedback: '[Crash Report]',
      feedbackWithoutDiagnosticBundle: '[Crash Report] without bundle',
      submissionType: 'crash',
      submitAnonymously: true,
      githubLogin: null,
      githubEmail: null,
      diagnosticBundle: {
        bundleSubmissionId: 'bundleabcdefghijklmnop',
        content: '{"type":"bundle-header"}\n',
        bytes: 25,
        spanCount: 1
      }
    })

    expect(result).toEqual(OPENED)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes the renderer feedback channel to a NASH issue', async () => {
    registerFeedbackHandlers()
    const handler = handlers.get('feedback:submit')

    const result = await handler?.(
      {},
      { feedback: 'hello', githubLogin: null, githubEmail: null, submitAnonymously: true }
    )

    expect(result).toEqual(OPENED)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a browser launch failure without claiming delivery', async () => {
    openExternal.mockRejectedValueOnce(new Error('launch failed'))
    expect(
      await submitFeedback({ feedback: 'Keep this report', githubLogin: null, githubEmail: null })
    ).toEqual({
      ok: false,
      status: null,
      error: 'Could not open the NASH GitHub issue form.'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

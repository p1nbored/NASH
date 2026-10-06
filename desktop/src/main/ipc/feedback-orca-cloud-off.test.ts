import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, handlers } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3-test' },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel))
  },
  net: { fetch: (...args: unknown[]) => fetchMock(...args) }
}))

import { registerFeedbackHandlers, submitFeedback } from './feedback'

const REFUSAL = {
  ok: false,
  status: null,
  code: 'orca_cloud_services_off',
  error: 'Sending feedback and crash reports to Orca is not available in NASH builds.'
}

describe('feedback in NASH builds (Orca cloud services off)', () => {
  beforeEach(() => {
    handlers.clear()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
  })

  it('refuses the feedback lane before any network call', async () => {
    const result = await submitFeedback({
      feedback: 'private bug report',
      githubLogin: 'someone',
      githubEmail: 'someone@example.test',
      images: [{ contentType: 'image/png', data: new Uint8Array([1, 2, 3]) }]
    })

    expect(result).toEqual(REFUSAL)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses the crash lane and its diagnostic bundle before any network call', async () => {
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

    expect(result).toEqual(REFUSAL)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses through the renderer feedback channel', async () => {
    registerFeedbackHandlers()
    const handler = handlers.get('feedback:submit')

    const result = await handler?.(
      {},
      { feedback: 'hello', githubLogin: null, githubEmail: null, submitAnonymously: true }
    )

    expect(result).toEqual(REFUSAL)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

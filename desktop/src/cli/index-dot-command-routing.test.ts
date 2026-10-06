import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveOrcaAppMock,
  getDefaultUserDataPathMock,
  readDotIngressMetadataMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveOrcaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/fixture-user-data'),
  readDotIngressMetadataMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

// FIXTURE_ONLY: the dot client never reads a real discovery file (it holds the ingress token).
vi.mock('./dot-ingress/dot-ingress-metadata-reader', async () => {
  const { RuntimeClientError } = await import('./runtime/types.js')
  return {
    readDotIngressMetadata: readDotIngressMetadataMock.mockImplementation(() => {
      throw new RuntimeClientError('dot_ingress_disabled', 'Fixture: the dot interface is off.')
    })
  }
})

import { main } from './index'

// The dot client talks to this machine's dot interface only, so a runtime selector must never
// route it (or a lookup for it) to another runtime, and an explicit one is refused, not ignored.

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  callMock.mockReset()
  runtimeClientConstructorMock.mockReset()
  readDotIngressMetadataMock.mockClear()
  process.exitCode = 0
})

function printedJson(spy: { mock: { calls: unknown[][] } }): {
  ok: boolean
  error?: { code: string; message: string }
} {
  return JSON.parse(String(spy.mock.calls[0]?.[0]))
}

describe('dot commands and remote selection', () => {
  it.each(['--environment', '--pairing-code'])(
    'refuses %s on a dot command before anything is contacted',
    async (flag) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await main(['dot', 'hello', flag, 'fixture-target', '--json'], '/tmp/repo')

      const printed = printedJson(logSpy)
      expect(printed.ok).toBe(false)
      expect(printed.error?.code).toBe('invalid_argument')
      expect(printed.error?.message).toContain(`\`${flag}\` does not retarget`)
      expect(process.exitCode).toBe(1)
      expect(runtimeClientConstructorMock).not.toHaveBeenCalled()
      expect(callMock).not.toHaveBeenCalled()
      expect(readDotIngressMetadataMock).not.toHaveBeenCalled()
    }
  )

  it('ignores an ambient ORCA_ENVIRONMENT and asks only the local dot interface', async () => {
    vi.stubEnv('ORCA_ENVIRONMENT', 'fixture-remote')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['dot', 'hello', '--json'], '/tmp/repo')

    expect(readDotIngressMetadataMock).toHaveBeenCalledTimes(1)
    expect(runtimeClientConstructorMock).not.toHaveBeenCalled()
    expect(callMock).not.toHaveBeenCalled()
    expect(printedJson(logSpy).error?.code).toBe('dot_ingress_disabled')
  })
})

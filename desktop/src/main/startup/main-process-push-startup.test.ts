import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  state: { runtime: {} as unknown, desktopPushService: null as unknown }
}))

vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('../runtime/push/desktop-push-service', () => ({
  DesktopPushService: { create: mocks.create }
}))
vi.mock('./main-process-state', () => ({ mainProcessState: mocks.state }))

import { startDesktopPushService } from './main-process-push-startup'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'

describe('desktop push startup in NASH builds (Orca cloud services off)', () => {
  beforeEach(() => {
    mocks.create.mockReset()
    mocks.state.desktopPushService = null
    vi.unstubAllEnvs()
  })

  it('starts no push gateway client, so no notification text reaches push.onorca.dev', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: startup returns before reading the RPC server.
    startDesktopPushService({} as OrcaRuntimeRpcServer)

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.state.desktopPushService).toBeNull()
  })

  it('starts push only for an explicitly configured gateway', () => {
    vi.stubEnv('ORCA_PUSH_GATEWAY_URL', 'https://push.example.test')
    const start = vi.fn()
    mocks.create.mockReturnValue({ start })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: DesktopPushService.create is mocked and ignores the server.
    startDesktopPushService({} as OrcaRuntimeRpcServer)

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ gatewayUrl: 'https://push.example.test' })
    )
    expect(start).toHaveBeenCalledOnce()
  })
})

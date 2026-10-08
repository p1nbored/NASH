import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

describe('paired permission settings', () => {
  let hostMode: GlobalSettings['agentPermissionMode']
  let refuseUpdate: boolean
  beforeEach(() => {
    vi.resetModules()
    hostMode = 'auto'
    refuseUpdate = false
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        async call(
          method: string,
          params?: Partial<GlobalSettings>
        ): Promise<RuntimeRpcResponse<unknown>> {
          if (method === 'settings.update') {
            if (refuseUpdate) {
              throw new Error('host unavailable')
            }
            hostMode = params?.agentPermissionMode
          }
          return {
            id: 'fixture',
            ok: true,
            result: { settings: { agentPermissionMode: hostMode } },
            _meta: { runtimeId: 'runtime-1' }
          }
        }
        close(): void {}
      }
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  async function connect() {
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ agentPermissionMode: 'manual' })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    return globals
  }

  it('displays the execution host permission mode', async () => {
    const { window } = await connect()
    expect((await window.api.settings.get()).agentPermissionMode).toBe('auto')
  })

  it('updates the execution host when Manual is selected', async () => {
    const { window } = await connect()
    await window.api.settings.set({ agentPermissionMode: 'manual' })
    expect(hostMode).toBe('manual')
  })

  it('does not report a successful mode change when the host refuses it', async () => {
    const { window, storage } = await connect()
    refuseUpdate = true
    await expect(window.api.settings.set({ agentPermissionMode: 'auto' })).rejects.toThrow(
      'host unavailable'
    )
    expect(JSON.parse(storage.getItem('orca.web.settings.v1') ?? '{}').agentPermissionMode).toBe(
      'manual'
    )
  })

  it('does not retain Auto as a host capability when an older host has no mode', async () => {
    const { window, storage } = await connect()
    storage.setItem('orca.web.settings.v1', JSON.stringify({ agentPermissionMode: 'auto' }))
    hostMode = undefined
    expect((await window.api.settings.get()).agentPermissionMode).toBeUndefined()
  })
})

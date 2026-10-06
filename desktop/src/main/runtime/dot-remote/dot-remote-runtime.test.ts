import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { requireDotRemoteControl } from './dot-remote-port'
import { createDotRemoteRuntime } from './dot-remote-runtime'
import { ensureDotRemoteSchema } from './dot-remote-schema'
import { memoryCredentials } from './dot-remote.test-fixture'

describe('dot remote runtime (production composition)', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ensureDotRemoteSchema(owner.db)
    getDotIngressSettingsStore(owner)
  })
  afterEach(() => owner.close())

  function build() {
    const fetch = vi.fn(async () => new Response('{}'))
    const runtime = {
      requireDotIngressControl: vi.fn(() => {
        throw new OrchestrationError('workbench_dot_ingress_unavailable', 'Fixture: no server.')
      })
    }
    const built = createDotRemoteRuntime({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the composition reads only the members this fixture provides.
      runtime: runtime as never,
      owner,
      userDataPath: 'C:/fixture/userData',
      credentials: memoryCredentials(),
      appVersion: '1.4.0',
      log: vi.fn(),
      fetch
    })
    return { built, fetch, runtime }
  }

  it('registers the desktop control and starts nothing while the switch is off', async () => {
    const { built, fetch, runtime } = build()
    built.start()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the registry keys by identity only.
    const control = requireDotRemoteControl(runtime as never)
    expect(control.status()).toMatchObject({ state: 'off', localEndpoint: 'unavailable' })
    await built.stop()
    expect(fetch).not.toHaveBeenCalled()
    built.uninstall()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the registry keys by identity only.
    expect(() => requireDotRemoteControl(runtime as never)).toThrow(OrchestrationError)
  })
})

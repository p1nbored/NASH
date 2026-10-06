import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClefCredentialGeneration } from '../clef/clef-credential-generation'
import { setClefCredentialSource, type ClefCredentialSource } from '../clef/clef-credential-port'
import type { AutopilotRateLimitSource } from './autopilot-host-ports'

const { install, builders, hostPorts, shutdown, remoteStore } = vi.hoisted(() => {
  const refuse = (what: string) => () => {
    throw new Error(`FIXTURE_ONLY: startup must not touch the remote ${what}.`)
  }
  return {
    install: vi.fn(),
    builders: vi.fn(() => ({ fixtureBuilders: true })),
    hostPorts: vi.fn(() => ({ fixtureHostPorts: true })),
    shutdown: vi.fn(async () => ({ pending: [] })),
    remoteStore: {
      status: vi.fn(refuse('token status')),
      read: vi.fn(refuse('token')),
      save: vi.fn(refuse('token save')),
      clear: vi.fn(refuse('token clear')),
      readDevice: vi.fn(refuse('device credential')),
      saveDevice: vi.fn(refuse('device credential save')),
      clearDevice: vi.fn(refuse('device credential clear'))
    }
  }
})

vi.mock('./autopilot-runtime-install', () => ({ installAutopilotRuntime: install }))
vi.mock('./autopilot-production-builders', () => ({ createProductionAutopilotBuilders: builders }))
vi.mock('./autopilot-host-ports', () => ({ createAutopilotHostPorts: hostPorts }))
vi.mock('./dot-remote-credential-store-install', () => ({
  installDotRemoteCredentialStore: () => remoteStore
}))
vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({
    getPath: (name: string) => `C:/fixture/${name}`,
    isPackaged: () => true,
    getVersion: () => '1.4.0'
  }),
  hasAppEnvironment: () => true
}))

import {
  beginAutopilotRuntimeShutdown,
  initializeMainProcessAutopilotRuntime
} from './main-process-autopilot-runtime'

const OWNER = { fixtureDatabase: true }

function fixtureRuntime() {
  return { getOrchestrationDb: vi.fn(() => OWNER) }
}

const SOURCES = {
  settings: vi.fn(),
  rateLimits: vi.fn((): AutopilotRateLimitSource | null => null)
}

async function runWith(runtime = fixtureRuntime()) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the binding reads only the one runtime member this fixture provides.
  await initializeMainProcessAutopilotRuntime(runtime as never, SOURCES)
  return runtime
}

function installPorts() {
  expect(install).toHaveBeenCalledTimes(1)
  return install.mock.calls[0]?.[0]
}

describe('initializeMainProcessAutopilotRuntime', () => {
  beforeEach(async () => {
    install.mockReset()
    install.mockResolvedValue({ report: { steps: [], launchesOpen: true }, shutdown })
    builders.mockClear()
    hostPorts.mockClear()
    shutdown.mockClear()
    SOURCES.rateLimits.mockReset()
    setClefCredentialSource(null)
    // Why: a previous test's installation must not answer this test's shutdown.
    await beginAutopilotRuntimeShutdown()
    shutdown.mockClear()
  })

  it('installs on the passive orchestration database under the user data folder', async () => {
    const runtime = await runWith()
    expect(runtime.getOrchestrationDb).toHaveBeenCalledExactlyOnceWith({ passive: true })
    expect(installPorts()).toMatchObject({
      owner: OWNER,
      userDataPath: 'C:/fixture/userData',
      cliCommand: 'orca'
    })
  })

  it('builds the production builders over host ports bound to the app services', async () => {
    const runtime = await runWith()
    expect(hostPorts).toHaveBeenCalledExactlyOnceWith({
      runtime,
      settings: SOURCES.settings,
      rateLimits: SOURCES.rateLimits
    })
    expect(builders).toHaveBeenCalledExactlyOnceWith({ fixtureHostPorts: true })
    expect(install.mock.calls[0]?.[1]).toEqual({ fixtureBuilders: true })
  })

  it('follows the credential source that is installed now, without reading it at install', async () => {
    await runWith()
    const { credentials } = installPorts()
    const generation = ClefCredentialGeneration.mint()
    const sealed: ClefCredentialSource = {
      status: () => ({ tokenPresent: true, accountPresent: true, protection: 'sealed' }),
      read: () => null,
      generation: () => generation
    }
    setClefCredentialSource(sealed)
    expect(credentials.status().protection).toBe('sealed')
    expect(credentials.generation()).toBe(generation)
  })

  it('reports account switches from the rate-limit service, read when the install subscribes', async () => {
    const unsubscribe = vi.fn()
    const service = {
      getState: vi.fn(),
      refresh: vi.fn(),
      onAccountChange: vi.fn(() => unsubscribe)
    }
    SOURCES.rateLimits.mockReturnValueOnce(service)
    await runWith()
    const { accountChanges } = installPorts()
    expect(service.onAccountChange).not.toHaveBeenCalled()
    const listener = vi.fn()
    const stop = accountChanges.subscribe(listener)
    expect(service.onAccountChange).toHaveBeenCalledExactlyOnceWith(listener)
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('subscribes to nothing when no rate-limit service is running', async () => {
    SOURCES.rateLimits.mockReturnValueOnce(null)
    await runWith()
    const stop = installPorts().accountChanges.subscribe(vi.fn())
    expect(() => stop()).not.toThrow()
  })

  it('hands remote access its sealed store and the app version, without reading the token', async () => {
    await runWith()
    const { dotRemote } = installPorts()
    expect(dotRemote).toEqual({ credentials: remoteStore, appVersion: '1.4.0' })
    for (const member of Object.values(remoteStore)) {
      expect(member).not.toHaveBeenCalled()
    }
  })

  it('logs a redacted failure and leaves everything uninstalled when the install throws', async () => {
    install.mockRejectedValue(
      new Error('disk failed for /client/v4/accounts/0123456789abcdef0123456789abcdef/ai')
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(runWith()).resolves.toBeDefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('0123456789abcdef0123456789abcdef')
    warn.mockRestore()
    await beginAutopilotRuntimeShutdown()
    expect(shutdown).not.toHaveBeenCalled()
  })
})

describe('beginAutopilotRuntimeShutdown', () => {
  it('resolves at once when nothing was installed', async () => {
    await expect(beginAutopilotRuntimeShutdown()).resolves.toBeUndefined()
  })

  it('runs the installation shutdown once, for the will-quit barrier', async () => {
    install.mockReset()
    install.mockResolvedValue({ report: { steps: [], launchesOpen: true }, shutdown })
    await runWith()
    await beginAutopilotRuntimeShutdown()
    await beginAutopilotRuntimeShutdown()
    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getDotIngressMetadataPath,
  type DotIngressMetadata
} from '../../../shared/dot-ingress/dot-ingress-metadata'
import { OrchestrationDb } from '../orchestration/db'
import { defineMethod, defineStreamingMethod, type RpcContext } from '../rpc/core'
import { DOT_INGRESS_RPC_METHODS } from '../rpc/methods/dot-ingress'
import { createDotIngressTransportMetadata } from '../runtime-rpc/runtime-rpc-socket-metadata'
import { UnixSocketTransport } from '../rpc/unix-socket-transport'
import { requireDotIngressCaller } from './dot-ingress-caller'
import { DotIngressListener, type DotIngressListenerOptions } from './dot-ingress-listener'
import { writeDotIngressMetadata } from './dot-ingress-metadata-file'
import {
  FIXTURE_CLI_TOKEN,
  FIXTURE_RUNTIME_ID,
  errorCodeOfFrame,
  readDotMetadata,
  sendFrame,
  sendRawLines,
  thrownCodeOf
} from './dot-ingress-transport.test-fixture'

const STARTED_AT = 1_790_000_000_000
const hello = (token: string, id = 'req-1') => ({
  id,
  authToken: token,
  method: 'dotIngress.hello',
  params: { contractVersion: 3 }
})

const staleMetadata = (pid: number): DotIngressMetadata => ({
  schemaVersion: 1 as const,
  runtimeId: 'runtime-crashed',
  pid,
  startedAt: STARTED_AT,
  contractVersions: [3],
  // Why: derived from the runtime naming code, so the fixture follows the app identity prefix.
  transport: createDotIngressTransportMetadata('/data', 1, 'win32', 'ab12'),
  ingressToken: 'd'.repeat(64)
})

async function refusesConnections(endpoint: string): Promise<boolean> {
  try {
    await sendRawLines(endpoint, ['{}'], 1)
    return false
  } catch {
    return true
  }
}

describe('dot ingress listener', () => {
  let userDataPath: string
  let db: OrchestrationDb
  let enabled: boolean
  let listeners: DotIngressListener[]
  const create = (
    overrides: Partial<Omit<DotIngressListenerOptions, 'runtime'>> = {},
    runtimeOverrides: Record<string, unknown> = {}
  ): DotIngressListener => {
    const listener = new DotIngressListener({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the listener reads only the members this fixture provides.
      runtime: {
        getRuntimeId: () => FIXTURE_RUNTIME_ID,
        getStartedAt: () => STARTED_AT,
        getOrchestrationDb: () => db,
        ...runtimeOverrides
      } as never,
      userDataPath,
      pid: process.pid,
      platform: process.platform,
      readEnabled: () => enabled,
      ...overrides
    })
    listeners.push(listener)
    return listener
  }
  const endpointOf = () =>
    createDotIngressTransportMetadata(
      userDataPath,
      process.pid,
      process.platform,
      FIXTURE_RUNTIME_ID
    ).endpoint
  const filePath = () => getDotIngressMetadataPath(userDataPath)

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'dot-ingress-listener-'))
    db = new OrchestrationDb(':memory:')
    enabled = false
    listeners = []
  })
  afterEach(async () => {
    await Promise.all(listeners.map((listener) => listener.shutdown()))
    db.close()
    vi.restoreAllMocks()
  })

  describe('while the interface is off', () => {
    it('starts nothing: no endpoint and no discovery file', async () => {
      const listener = create()

      expect(await listener.sync()).toEqual({ enabled: false, listening: false, failure: null })
      expect(existsSync(filePath())).toBe(false)
      expect(await refusesConnections(endpointOf())).toBe(true)
    })

    it('removes a discovery file a crashed runtime left behind', async () => {
      writeDotIngressMetadata(userDataPath, staleMetadata(99_999_999))
      const listener = create()

      await listener.sync()

      expect(existsSync(filePath())).toBe(false)
    })

    it('keeps a discovery file that belongs to another live runtime', async () => {
      writeDotIngressMetadata(userDataPath, staleMetadata(process.pid))
      const listener = create({ pid: 4242 })

      await listener.sync()

      expect(existsSync(filePath())).toBe(true)
    })
  })

  describe('when the user turns the interface on', () => {
    it('publishes an owner-only discovery file that names the dedicated endpoint', async () => {
      const listener = create()
      enabled = true

      expect(await listener.sync()).toEqual({ enabled: true, listening: true, failure: null })
      const metadata = readDotMetadata(userDataPath)

      expect(metadata).toMatchObject({
        schemaVersion: 1,
        runtimeId: FIXTURE_RUNTIME_ID,
        pid: process.pid,
        startedAt: STARTED_AT,
        contractVersions: [3],
        transport: { endpoint: endpointOf() }
      })
      expect(metadata.ingressToken).toMatch(/^[0-9a-f]{64}$/)
    })

    it('answers hello with the ingress token only', async () => {
      const listener = create()
      enabled = true
      await listener.sync()
      const { ingressToken } = readDotMetadata(userDataPath)

      const accepted = await sendFrame(endpointOf(), hello(ingressToken))
      const withCliToken = await sendFrame(endpointOf(), hello(FIXTURE_CLI_TOKEN))
      const withoutToken = await sendFrame(endpointOf(), {
        id: 'req-3',
        method: 'dotIngress.hello'
      })

      expect(accepted).toMatchObject({ id: 'req-1', ok: true, result: { contractVersion: 3 } })
      expect(errorCodeOfFrame(withCliToken)).toBe('unauthorized')
      expect(errorCodeOfFrame(withoutToken)).toBe('unauthorized')
    })

    it('rotates the token on every start, and the old token is refused afterwards', async () => {
      const listener = create()
      enabled = true
      await listener.sync()
      const first = readDotMetadata(userDataPath).ingressToken
      enabled = false
      await listener.sync()
      enabled = true
      await listener.sync()
      const second = readDotMetadata(userDataPath).ingressToken

      expect(second).not.toBe(first)
      expect(errorCodeOfFrame(await sendFrame(endpointOf(), hello(first)))).toBe('unauthorized')
      expect(await sendFrame(endpointOf(), hello(second))).toMatchObject({ ok: true })
    })

    it('answers an oversized frame with request_too_large and does not stop serving', async () => {
      const listener = create()
      enabled = true
      await listener.sync()
      const { ingressToken } = readDotMetadata(userDataPath)

      const [oversized] = await sendRawLines(endpointOf(), ['x'.repeat(1024 * 1024 + 1)], 1)

      expect(errorCodeOfFrame(oversized ?? {})).toBe('request_too_large')
      expect(await sendFrame(endpointOf(), hello(ingressToken))).toMatchObject({ ok: true })
    })

    it('answers many frames on one connection by id', async () => {
      const listener = create()
      enabled = true
      await listener.sync()
      const { ingressToken } = readDotMetadata(userDataPath)
      const lines = Array.from({ length: 20 }, (_, i) =>
        JSON.stringify(hello(ingressToken, `r${i}`))
      )

      const responses = await sendRawLines(endpointOf(), lines)

      expect(responses.map((response) => response.id).sort()).toEqual(
        Array.from({ length: 20 }, (_, i) => `r${i}`).sort()
      )
      expect(responses.every((response) => response.ok === true)).toBe(true)
    })
  })

  describe('when the user turns the interface off', () => {
    it('tears the endpoint down and removes the discovery file', async () => {
      const listener = create()
      enabled = true
      await listener.sync()
      enabled = false

      expect(await listener.sync()).toEqual({ enabled: false, listening: false, failure: null })
      expect(existsSync(filePath())).toBe(false)
      expect(await refusesConnections(endpointOf())).toBe(true)
    })

    it('finishes a start that is still opening before it honours a later off request', async () => {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let opening = false
      const listener = create({
        createTransport: (options) => {
          const transport = new UnixSocketTransport(options)
          return {
            onMessage: (handler) => transport.onMessage(handler),
            start: async () => {
              opening = true
              await gate
              await transport.start()
            },
            stop: () => transport.stop()
          }
        }
      })
      enabled = true
      const first = listener.sync()
      await vi.waitFor(() => expect(opening).toBe(true))
      enabled = false
      const second = listener.sync()
      release()

      await Promise.all([first, second])

      expect(listener.status()).toEqual({ enabled: false, listening: false, failure: null })
      expect(existsSync(filePath())).toBe(false)
      expect(await refusesConnections(endpointOf())).toBe(true)
    })

    it('shares one endpoint between syncs that ask for the same state', async () => {
      const listener = create()
      enabled = true

      const results = await Promise.all([listener.sync(), listener.sync(), listener.sync()])

      expect(results.every((status) => status.listening)).toBe(true)
      expect(readDotMetadata(userDataPath).transport.endpoint).toBe(endpointOf())
    })
  })

  describe('shutdown', () => {
    it('removes its own file and never restarts afterwards', async () => {
      const listener = create()
      enabled = true
      await listener.sync()

      await listener.shutdown()
      await listener.shutdown()

      expect(existsSync(filePath())).toBe(false)
      expect(await listener.sync()).toEqual({ enabled: false, listening: false, failure: null })
      expect(existsSync(filePath())).toBe(false)
    })

    it('leaves a discovery file that another runtime has since written', async () => {
      const listener = create()
      enabled = true
      await listener.sync()
      const own = readDotMetadata(userDataPath)
      const successor = { ...own, runtimeId: 'runtime-fixture-2', ingressToken: 'e'.repeat(64) }
      writeDotIngressMetadata(userDataPath, successor)

      await listener.shutdown()

      expect(readDotMetadata(userDataPath)).toEqual(successor)
    })
  })

  describe('failure handling', () => {
    it('stays off and reports a coarse failure when the discovery file cannot be written, then recovers', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      mkdirSync(filePath())
      const listener = create()
      enabled = true

      const failed = await listener.sync()

      expect(failed).toEqual({ enabled: true, listening: false, failure: 'metadata_write_failed' })
      expect(await refusesConnections(endpointOf())).toBe(true)
      expect(JSON.stringify(error.mock.calls)).not.toMatch(/[0-9a-f]{64}/)

      rmSync(filePath(), { recursive: true })
      expect(await listener.sync()).toEqual({ enabled: true, listening: true, failure: null })
    })

    it('reports listen_failed and leaves no discovery file when the endpoint cannot be opened', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const listener = create({
        createTransport: () => ({
          onMessage: () => {},
          start: () => Promise.reject(new Error('EADDRINUSE fixture')),
          stop: () => Promise.resolve()
        })
      })
      enabled = true

      expect(await listener.sync()).toEqual({
        enabled: true,
        listening: false,
        failure: 'listen_failed'
      })
      expect(existsSync(filePath())).toBe(false)
    })

    it('stops an endpoint whose start failed, so nothing it opened stays behind', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const stop = vi.fn(() => Promise.resolve())
      const listener = create({
        createTransport: () => ({
          onMessage: () => {},
          start: () => Promise.reject(new Error('EADDRINUSE fixture')),
          stop
        })
      })
      enabled = true

      expect((await listener.sync()).failure).toBe('listen_failed')
      expect(stop).toHaveBeenCalledOnce()
    })

    it('never leaves a rejection unhandled when the last-resort reply cannot be sent', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const captured: {
        handler: ((message: string, reply: (response: string) => void) => void) | null
      } = { handler: null }
      const listener = create({
        createTransport: () => ({
          onMessage: (onMessage) => {
            captured.handler = onMessage
          },
          start: () => Promise.resolve(),
          stop: () => Promise.resolve()
        })
      })
      enabled = true
      await listener.sync()
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)
      try {
        const reply = vi.fn(() => {
          throw new Error('socket closed at C:\\private')
        })
        captured.handler?.('{"id":"req-1"}', reply)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(reply).toHaveBeenCalledTimes(2)
        expect(unhandled).not.toHaveBeenCalled()
        expect(JSON.stringify(error.mock.calls)).not.toContain('private')
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    it('opens nothing and reports metadata_invalid when the discovery file cannot be described', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const createTransport = vi.fn()
      const listener = create(
        { createTransport },
        {
          getStartedAt: () => {
            throw new Error('runtime not started')
          }
        }
      )
      enabled = true

      expect(await listener.sync()).toEqual({
        enabled: true,
        listening: false,
        failure: 'metadata_invalid'
      })
      expect(createTransport).not.toHaveBeenCalled()
    })

    it('shows a failing switch reader to the caller, opens nothing, and keeps working afterwards', async () => {
      let broken = true
      const listener = create({
        readEnabled: () => {
          if (broken) {
            throw new Error('switch reader failed')
          }
          return enabled
        }
      })

      await expect(listener.sync()).rejects.toThrow('switch reader failed')
      expect(listener.status().listening).toBe(false)
      expect(existsSync(filePath())).toBe(false)

      broken = false
      enabled = true
      expect(await listener.sync()).toEqual({ enabled: true, listening: true, failure: null })
    })
  })

  describe('registry and caller', () => {
    const probe = vi.fn((_params: unknown, context: RpcContext) => ({
      principalId: requireDotIngressCaller(context.dotIngressCaller).principalId,
      hasDesktopCaller: context.workbenchCaller !== undefined,
      hasFingerprint: context.authenticatedCallerFingerprint !== undefined,
      hasOrchestrationCaller: context.orchestrationCaller !== undefined
    }))
    const probeMethod = defineMethod({ name: 'dotIngress.probe', params: null, handler: probe })
    const boom = defineMethod({
      name: 'dotIngress.boom',
      params: null,
      handler: () => {
        throw new Error('unable to open C:\\Users\\leaked-marker\\orchestration.db')
      }
    })

    it('hands handlers only a dot caller and no desktop or orchestration identity', async () => {
      probe.mockClear()
      const listener = create({ methods: [...DOT_INGRESS_RPC_METHODS, probeMethod] })
      enabled = true
      await listener.sync()
      const { ingressToken } = readDotMetadata(userDataPath)

      const response = await sendFrame(endpointOf(), {
        id: 'req-1',
        authToken: ingressToken,
        method: 'dotIngress.probe',
        workbenchCaller: { principalId: 'local-desktop-ui', source: 'desktop_ui' }
      })

      expect(response).toMatchObject({
        ok: true,
        result: {
          principalId: 'dot-ingress',
          hasDesktopCaller: false,
          hasFingerprint: false,
          hasOrchestrationCaller: false
        }
      })
    })

    it('runs no handler for a refused frame', async () => {
      probe.mockClear()
      const listener = create({ methods: [probeMethod] })
      enabled = true
      await listener.sync()

      await sendFrame(endpointOf(), {
        id: 'req-1',
        authToken: FIXTURE_CLI_TOKEN,
        method: 'dotIngress.probe'
      })

      expect(probe).not.toHaveBeenCalled()
    })

    it('answers a generic error with the request id when dispatching itself fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      let lost = false
      const listener = create(
        {},
        {
          getRuntimeId: () => {
            if (lost) {
              throw new Error('runtime lost')
            }
            return FIXTURE_RUNTIME_ID
          }
        }
      )
      enabled = true
      await listener.sync()
      const { ingressToken } = readDotMetadata(userDataPath)
      lost = true

      expect(await sendFrame(endpointOf(), hello(ingressToken))).toMatchObject({
        id: 'req-1',
        ok: false,
        error: { code: 'internal_error' }
      })
    })

    it('turns an unexpected handler failure into a generic error and logs no message text', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const listener = create({ methods: [boom] })
      enabled = true
      await listener.sync()
      const { ingressToken } = readDotMetadata(userDataPath)

      const response = await sendFrame(endpointOf(), {
        id: 'req-1',
        authToken: ingressToken,
        method: 'dotIngress.boom'
      })

      expect(errorCodeOfFrame(response)).toBe('internal_error')
      expect(JSON.stringify(response)).not.toContain('leaked-marker')
      expect(JSON.stringify(error.mock.calls)).not.toContain('leaked-marker')
    })

    it.each([
      [
        'a name outside the dotIngress namespace',
        defineMethod({ name: 'status.get', params: null, handler: () => ({}) })
      ],
      [
        'a name that only resembles the prefix',
        defineMethod({ name: 'dotIngressX.run', params: null, handler: () => ({}) })
      ],
      [
        'a streaming method',
        defineStreamingMethod({ name: 'dotIngress.watch', params: null, handler: async () => {} })
      ]
    ])('refuses to build with %s', (_name, method) => {
      expect(thrownCodeOf(() => create({ methods: [method] }))).toBe('dot_ingress_registry_invalid')
    })
  })
})

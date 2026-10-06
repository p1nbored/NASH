import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDotIngressMetadataPath } from '../../shared/dot-ingress/dot-ingress-metadata'
import { getRuntimeMetadataPath } from '../../shared/runtime-bootstrap'
import * as secureFile from '../../shared/secure-file'
import {
  errorCodeOfFrame,
  readDotMetadata,
  sendFrame,
  sendFrames,
  sendRawLines
} from './dot-ingress/dot-ingress-transport.test-fixture'
import { OrchestrationDb } from './orchestration/db'
import { getDotIngressSettingsStore } from './orchestration/db/dot-ingress-settings-store'
import { OrcaRuntimeService } from './orca-runtime'
import { ALL_RPC_METHODS } from './rpc/methods'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { readRuntimeMetadata } from './runtime-metadata'
import { createDotIngressTransportMetadata } from './runtime-rpc/runtime-rpc-socket-metadata'

vi.mock('../../shared/secure-file', async (importOriginal) => {
  const actual = await importOriginal<typeof secureFile>()
  return { ...actual, writeSecureJsonFile: vi.fn(actual.writeSecureJsonFile) }
})

const TIMESTAMP = '2026-10-05T00:00:00.000Z'

describe('runtime RPC server with the dot ingress endpoint', () => {
  let userDataPath: string
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let server: OrcaRuntimeRpcServer
  const dotFile = () => getDotIngressMetadataPath(userDataPath)
  const settings = () => getDotIngressSettingsStore(db)
  const dotEndpoint = () =>
    createDotIngressTransportMetadata(
      userDataPath,
      process.pid,
      process.platform,
      runtime.getRuntimeId()
    ).endpoint
  const cliMetadata = () => {
    const metadata = readRuntimeMetadata(userDataPath)
    const transport = metadata?.transports.find((t) => t.kind !== 'websocket')
    if (!metadata?.authToken || !transport) {
      throw new Error('the CLI endpoint is not published')
    }
    return { token: metadata.authToken, endpoint: transport.endpoint }
  }
  const switchInterface = async (on: boolean) => {
    settings().setEnabled({ enabled: on, timestamp: TIMESTAMP })
    return await runtime.requireDotIngressControl().sync()
  }
  const refusesConnections = async (endpoint: string) => {
    try {
      await sendRawLines(endpoint, ['{}'], 1)
      return false
    } catch {
      return true
    }
  }

  beforeEach(async () => {
    userDataPath = mkdtempSync(join(tmpdir(), 'dot-ingress-rpc-'))
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    runtime.installDotIngressEnabledReader(
      () => getDotIngressSettingsStore(db).getSettings().enabled
    )
    server = new OrcaRuntimeRpcServer({ runtime, userDataPath })
    vi.mocked(secureFile.writeSecureJsonFile).mockClear()
  })
  afterEach(async () => {
    await server.stop()
    db.close()
  })

  describe('with the interface off, which is the default', () => {
    it('opens no endpoint and writes no discovery file, while the CLI endpoint works', async () => {
      await server.start()

      expect(existsSync(dotFile())).toBe(false)
      expect(readdirSync(userDataPath).filter((name) => name.includes('-dot'))).toEqual([])
      expect(await refusesConnections(dotEndpoint())).toBe(true)
      const cli = cliMetadata()
      expect(
        await sendFrame(cli.endpoint, { id: 'req-1', authToken: cli.token, method: 'status.get' })
      ).toMatchObject({ ok: true })
    })

    it('reports a control that is off and not listening', async () => {
      await server.start()

      expect(runtime.requireDotIngressControl().status()).toEqual({
        enabled: false,
        listening: false,
        failure: null
      })
    })
  })

  describe('turning the interface on and off', () => {
    it('creates an owner-only discovery file and an endpoint the moment it is enabled', async () => {
      await server.start()

      expect(await switchInterface(true)).toEqual({ enabled: true, listening: true, failure: null })

      expect(secureFile.writeSecureJsonFile).toHaveBeenCalledWith(dotFile(), expect.anything())
      const metadata = readDotMetadata(userDataPath)
      expect(metadata).toMatchObject({
        runtimeId: runtime.getRuntimeId(),
        pid: process.pid,
        transport: { endpoint: dotEndpoint() }
      })
      if (process.platform !== 'win32') {
        expect(statSync(dotFile()).mode & 0o777).toBe(0o600)
      }
    })

    it('keeps the two tokens apart in the two discovery files', async () => {
      await server.start()
      await switchInterface(true)

      const cli = cliMetadata()
      const ingress = readDotMetadata(userDataPath).ingressToken

      expect(ingress).not.toBe(cli.token)
      expect(readFileSync(getRuntimeMetadataPath(userDataPath), 'utf8')).not.toContain(ingress)
      expect(readFileSync(dotFile(), 'utf8')).not.toContain(cli.token)
    })

    it('starts at once when the persisted switch is already on at startup', async () => {
      settings().setEnabled({ enabled: true, timestamp: TIMESTAMP })

      await server.start()

      expect(existsSync(dotFile())).toBe(true)
      expect(runtime.requireDotIngressControl().status().listening).toBe(true)
    })

    it('removes the endpoint and the file when it is disabled, and the CLI endpoint is unaffected', async () => {
      await server.start()
      await switchInterface(true)

      expect(await switchInterface(false)).toEqual({
        enabled: false,
        listening: false,
        failure: null
      })

      expect(existsSync(dotFile())).toBe(false)
      expect(await refusesConnections(dotEndpoint())).toBe(true)
      const cli = cliMetadata()
      expect(
        await sendFrame(cli.endpoint, { id: 'req-1', authToken: cli.token, method: 'status.get' })
      ).toMatchObject({ ok: true })
    })

    it('issues a new token on every start', async () => {
      await server.start()
      await switchInterface(true)
      const first = readDotMetadata(userDataPath).ingressToken
      await switchInterface(false)
      await switchInterface(true)

      expect(readDotMetadata(userDataPath).ingressToken).not.toBe(first)
    })

    it('removes its own file and endpoint when the server stops', async () => {
      await server.start()
      await switchInterface(true)
      const endpoint = dotEndpoint()

      await server.stop()

      expect(existsSync(dotFile())).toBe(false)
      expect(await refusesConnections(endpoint)).toBe(true)
      expect(() => runtime.requireDotIngressControl()).toThrow(/not available/i)
    })

    it('does not come back after the server stopped', async () => {
      await server.start()
      const control = runtime.requireDotIngressControl()
      await server.stop()

      settings().setEnabled({ enabled: true, timestamp: TIMESTAMP })

      expect(await control.sync()).toEqual({ enabled: false, listening: false, failure: null })
      expect(existsSync(dotFile())).toBe(false)
    })
  })

  describe('with the interface on', () => {
    let ingress: { token: string; endpoint: string }
    let cli: { token: string; endpoint: string }
    beforeEach(async () => {
      await server.start()
      await switchInterface(true)
      const metadata = readDotMetadata(userDataPath)
      ingress = { token: metadata.ingressToken, endpoint: metadata.transport.endpoint }
      cli = cliMetadata()
    })

    it('refuses each token on the other endpoint and accepts it on its own', async () => {
      const frame = (authToken: string, method: string) => ({ id: 'req-1', authToken, method })

      expect(
        errorCodeOfFrame(await sendFrame(cli.endpoint, frame(ingress.token, 'status.get')))
      ).toBe('unauthorized')
      expect(
        errorCodeOfFrame(await sendFrame(ingress.endpoint, frame(cli.token, 'dotIngress.hello')))
      ).toBe('unauthorized')
      expect(
        errorCodeOfFrame(await sendFrame(ingress.endpoint, frame(cli.token, 'status.get')))
      ).toBe('unauthorized')
      expect(await sendFrame(cli.endpoint, frame(cli.token, 'status.get'))).toMatchObject({
        ok: true
      })
      expect(
        await sendFrame(ingress.endpoint, {
          ...frame(ingress.token, 'dotIngress.hello'),
          params: { contractVersion: 1 }
        })
      ).toMatchObject({ ok: true, result: { contractVersion: 1 } })
    })

    it('answers method_not_found for every ALL_RPC_METHODS name over the ingress endpoint', async () => {
      const names = ALL_RPC_METHODS.map((method) => method.name)
      const wrong: string[] = []

      for (let start = 0; start < names.length; start += 150) {
        const chunk = names.slice(start, start + 150)
        const responses = await sendFrames(
          ingress.endpoint,
          chunk.map((method) => ({ id: method, authToken: ingress.token, method, params: {} }))
        )
        for (const response of responses) {
          if (response.ok !== false || errorCodeOfFrame(response) !== 'method_not_found') {
            wrong.push(String(response.id))
          }
        }
        expect(responses).toHaveLength(chunk.length)
      }

      expect(names.length).toBeGreaterThan(500)
      expect(wrong).toEqual([])
    })

    it.each([
      'status.get',
      'terminal.send',
      'settings.update',
      'workbench.requests.submit',
      'workbench.clef.verify',
      'workbench.clef.profile.pin'
    ])('answers method_not_found for %s over the ingress endpoint', async (method) => {
      expect(
        errorCodeOfFrame(
          await sendFrame(ingress.endpoint, { id: 'r', authToken: ingress.token, method })
        )
      ).toBe('method_not_found')
    })

    it('answers method_not_found for the ingress method on the CLI endpoint', async () => {
      expect(
        errorCodeOfFrame(
          await sendFrame(cli.endpoint, {
            id: 'r',
            authToken: cli.token,
            method: 'dotIngress.hello',
            params: { contractVersion: 1 }
          })
        )
      ).toBe('method_not_found')
    })

    it('never puts a path, a runtime id or a token in a response', async () => {
      const response = await sendFrame(ingress.endpoint, {
        id: 'req-1',
        authToken: ingress.token,
        method: 'dotIngress.hello',
        params: { contractVersion: 1 }
      })
      const text = JSON.stringify(response)

      expect(text).not.toContain(userDataPath)
      expect(text).not.toContain(ingress.token)
      expect(text).not.toContain(cli.token)
    })

    it('stops serving the old endpoint the moment it is disabled, even for a held token', async () => {
      await switchInterface(false)

      await expect(
        sendFrame(ingress.endpoint, {
          id: 'req-1',
          authToken: ingress.token,
          method: 'dotIngress.hello',
          params: { contractVersion: 1 }
        })
      ).rejects.toThrow()
    })
  })
})

// FIXTURE_ONLY: an in-process local socket stands in for the dot endpoint; tokens and ids are synthetic.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DOT_INGRESS_CONTRACT_VERSION } from '../../../shared/dot-ingress/dot-ingress-limits'
import {
  readDotIngressTarget,
  sendDotIngressFrame,
  type DotIngressTarget
} from './dot-remote-ingress-pipe'

const INGRESS_TOKEN = '0123456789abcdef'.repeat(4)
const RUNTIME_ID = 'runtime-fixture-1'

type Reply = (frame: Record<string, unknown>, socket: Socket) => void

const servers: Server[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise((resolve) => server.close(resolve))
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function endpointPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\orca-${process.pid}-r1fixture${randomUUID().slice(0, 8)}-dot`
  }
  const dir = mkdtempSync(join(tmpdir(), 'r1-dot-'))
  dirs.push(dir)
  return join(dir, `o-${process.pid}-r1fixture-dot.sock`)
}

async function fixtureEndpoint(reply: Reply) {
  const received: Record<string, unknown>[] = []
  const endpoint = endpointPath()
  const server = createServer((socket) => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline === -1) {
        return
      }
      const frame: Record<string, unknown> = JSON.parse(buffer.slice(0, newline))
      received.push(frame)
      reply(frame, socket)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(endpoint, resolve))
  const target: DotIngressTarget = { endpoint, ingressToken: INGRESS_TOKEN, runtimeId: RUNTIME_ID }
  return { target, received }
}

const answer = (socket: Socket, frame: unknown) => socket.write(`${JSON.stringify(frame)}\n`)

describe('sendDotIngressFrame', () => {
  it('sends one frame with the ingress token and no envelope, skipping keepalives', async () => {
    const { target, received } = await fixtureEndpoint((frame, socket) => {
      answer(socket, { _keepalive: true })
      answer(socket, {
        id: frame.id,
        ok: true,
        result: { fixture: 1 },
        _meta: { runtimeId: RUNTIME_ID }
      })
    })
    const response = await sendDotIngressFrame(
      target,
      'dotIngress.requests.status',
      { a: 1 },
      5_000
    )
    expect(response).toMatchObject({ ok: true, result: { fixture: 1 } })
    expect(received).toHaveLength(1)
    expect(Object.keys(received[0] ?? {}).sort()).toEqual(['authToken', 'id', 'method', 'params'])
    expect(received[0]).toMatchObject({
      authToken: INGRESS_TOKEN,
      method: 'dotIngress.requests.status',
      params: { a: 1 }
    })
  })

  it('returns a refusal frame as it came', async () => {
    const { target } = await fixtureEndpoint((frame, socket) =>
      answer(socket, {
        id: frame.id,
        ok: false,
        error: { code: 'dot_workspace_unknown', message: 'Fixture refusal.' },
        _meta: { runtimeId: RUNTIME_ID }
      })
    )
    const response = await sendDotIngressFrame(target, 'dotIngress.requests.submit', {}, 5_000)
    expect(response).toMatchObject({ ok: false, error: { code: 'dot_workspace_unknown' } })
  })

  it.each([
    [
      'a mismatched id',
      (_frame: Record<string, unknown>) => ({
        id: 'other',
        ok: true,
        result: 1,
        _meta: { runtimeId: RUNTIME_ID }
      })
    ],
    [
      'another runtime',
      (frame: Record<string, unknown>) => ({
        id: frame.id,
        ok: true,
        result: 1,
        _meta: { runtimeId: 'runtime-2' }
      })
    ],
    ['an invalid frame', () => ({ id: 7 })]
  ])('rejects %s without naming the token', async (_case, build) => {
    const { target } = await fixtureEndpoint((frame, socket) => answer(socket, build(frame)))
    const failure = await sendDotIngressFrame(
      target,
      'dotIngress.requests.status',
      {},
      5_000
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).not.toContain(INGRESS_TOKEN)
  })

  it('rejects when the endpoint closes before answering, or never answers in time', async () => {
    const closing = await fixtureEndpoint((_frame, socket) => socket.end())
    await expect(sendDotIngressFrame(closing.target, 'm', {}, 5_000)).rejects.toThrow()
    const silent = await fixtureEndpoint(() => undefined)
    await expect(sendDotIngressFrame(silent.target, 'm', {}, 50)).rejects.toThrow()
  })

  it('rejects when nothing listens', async () => {
    const target: DotIngressTarget = {
      endpoint: endpointPath(),
      ingressToken: INGRESS_TOKEN,
      runtimeId: RUNTIME_ID
    }
    await expect(sendDotIngressFrame(target, 'm', {}, 5_000)).rejects.toThrow()
  })
})

describe('readDotIngressTarget', () => {
  const metadata = {
    schemaVersion: 1,
    runtimeId: RUNTIME_ID,
    pid: 4242,
    startedAt: 1,
    contractVersions: [DOT_INGRESS_CONTRACT_VERSION],
    transport: { kind: 'named-pipe', endpoint: '\\\\.\\pipe\\orca-4242-fixture-dot' },
    ingressToken: INGRESS_TOKEN
  }

  it('reads the endpoint and token from the discovery file under the data folder', () => {
    const paths: string[] = []
    const target = readDotIngressTarget('C:/fixture/userData', (path) => {
      paths.push(path)
      return JSON.stringify(metadata)
    })
    expect(target).toEqual({
      endpoint: metadata.transport.endpoint,
      ingressToken: INGRESS_TOKEN,
      runtimeId: RUNTIME_ID
    })
    expect(paths).toEqual([join('C:/fixture/userData', 'dot-ingress-runtime.json')])
  })

  it.each([
    [
      'a missing file',
      () => {
        throw new Error('Fixture: ENOENT')
      }
    ],
    ['broken JSON', () => '{'],
    ['an unexpected shape', () => JSON.stringify({ ...metadata, ingressToken: 'short' })]
  ])('answers null for %s', (_case, readText) => {
    expect(readDotIngressTarget('C:/fixture/userData', readText)).toBeNull()
  })
})

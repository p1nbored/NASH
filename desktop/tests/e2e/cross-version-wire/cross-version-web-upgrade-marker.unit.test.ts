import WebSocket from 'ws'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { WebSocketTransport } from '../../../src/main/runtime/rpc/ws-transport'
import { withWebClientUpgradeMarker } from '../../../src/shared/web-origin-security'
import {
  importReleaseCheckoutModule,
  materializeReleaseCheckout,
  resolveBaselineReleaseRef
} from './release-checkout'

/**
 * The updated web client marks its WebSocket upgrade with `?orca-client=web` so a host can tell
 * it from a phone (React Native also sends an http Origin). A released host must still accept the
 * marked upgrade, and this host must record the marker only when it is present.
 */
const SUITE_TIMEOUT_MS = 180_000
const LAN_PAGE = 'http://192.168.1.20:6768'

type TransportLike = {
  start(): Promise<void>
  stop(): Promise<void>
  readonly resolvedPort: number
  onMessage(handler: (message: unknown, reply: unknown, ws: WebSocket) => void): void
}
type TransportConstructor = new (options: Record<string, unknown>) => TransportLike

let ReleasedTransport: TransportConstructor
const running: TransportLike[] = []

beforeAll(async () => {
  const checkout = await materializeReleaseCheckout(resolveBaselineReleaseRef())
  const module = await importReleaseCheckoutModule(checkout, 'src/main/runtime/rpc/ws-transport.ts')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the pinned release's WebSocketTransport; a changed shape fails the assertions below.
  ReleasedTransport = module.WebSocketTransport as TransportConstructor
}, SUITE_TIMEOUT_MS)

afterEach(async () => {
  await Promise.all(running.splice(0).map((transport) => transport.stop()))
})

async function dial(transport: TransportLike, marked: boolean): Promise<WebSocket> {
  const received = new Promise<WebSocket>((resolve) =>
    transport.onMessage((_message, _reply, ws) => resolve(ws))
  )
  const base = `ws://127.0.0.1:${transport.resolvedPort}`
  const client = new WebSocket(marked ? withWebClientUpgradeMarker(base) : base, {
    headers: { Origin: LAN_PAGE }
  })
  await new Promise<void>((resolve, reject) => {
    client.once('open', resolve)
    client.once('error', reject)
  })
  client.send('{"type":"e2ee_hello"}')
  const serverSide = await received
  client.close()
  return serverSide
}

async function started(Transport: TransportConstructor): Promise<TransportLike> {
  const transport = new Transport({ host: '127.0.0.1', port: 0, preAuthTimeoutMs: 60_000 })
  await transport.start()
  running.push(transport)
  return transport
}

describe('cross-version: web client upgrade marker', () => {
  it('a released host accepts the marked upgrade and receives its frames', async () => {
    const transport = await started(ReleasedTransport)
    await expect(dial(transport, true)).resolves.toBeDefined()
  })

  it('this host records the marker for the web bundle only, never for a phone', async () => {
    const transport = new WebSocketTransport({
      host: '127.0.0.1',
      port: 0,
      preAuthTimeoutMs: 60_000
    })
    await transport.start()
    running.push(transport)
    const web = await dial(transport, true)
    expect(transport.webPageOf(web)).toEqual({ webOrigin: LAN_PAGE, webClient: true })
    const phone = await dial(transport, false)
    expect(transport.webPageOf(phone)).toBeUndefined()
  })
})

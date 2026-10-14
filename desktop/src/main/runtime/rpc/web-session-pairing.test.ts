import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import type { WebSocket } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { encodeDeviceProofMessage } from '../../../shared/device-key-proof'
import { DeviceRegistry } from '../device-registry'
import { EPHEMERAL_DEVICE_IDLE_MS } from '../ephemeral-device-rows'
import { SimulatedMobileE2EEV2Peer } from '../relay/simulated-mobile-e2ee-v2-peer'
import { registerSocketDeviceKey } from '../runtime-rpc/runtime-rpc-device-key-registration'
import { generateKeyPair } from './e2ee-crypto'
import {
  MobileSocketWiring,
  type AuthenticatedMobileSocket,
  type MobileSocketTransport,
  type MobileSocketTransportMetadata
} from './mobile-socket-wiring'

class FakeSocket {
  readonly OPEN = 1
  readyState = this.OPEN
  bufferedAmount = 0
  readonly sent: (string | Buffer)[] = []
  readonly send = vi.fn((data: string | Buffer) => this.sent.push(data))
  readonly close = vi.fn()
}

class FakeTransport implements MobileSocketTransport {
  private messageHandler: Parameters<MobileSocketTransport['onMessage']>[0] | null = null
  readonly setClientId = vi.fn()
  readonly terminateClientConnections = vi.fn(() => 0)
  onMessage(handler: Parameters<MobileSocketTransport['onMessage']>[0]): void {
    this.messageHandler = handler
  }
  onConnectionClose(): void {}
  receive(ws: FakeSocket, message: string): void {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the wiring only sends, closes and reads OPEN/readyState/bufferedAmount.
    this.messageHandler?.(message, vi.fn(), ws as unknown as WebSocket)
  }
}

const desktop = generateKeyPair()
const LAN_PAGE = 'http://192.168.1.20:6768'
const RELAY_HOST_ID = 'AbCdEf0123_-xyZ9'

// The new web bundle marks its upgrade; phones (React Native) send an http Origin but no marker.
const WEB_CLIENT = { webOrigin: LAN_PAGE, webClient: true as const }

function harness(
  page: { webOrigin?: string; webClient?: true } | undefined,
  allowInsecureWebPairing = false,
  relay?: (deviceId: string) => MobileSocketTransportMetadata
) {
  const registry = new DeviceRegistry(mkdtempSync(join(tmpdir(), 'orca-web-session-')))
  const transport = new FakeTransport()
  const ready: AuthenticatedMobileSocket[] = []
  const wiring = new MobileSocketWiring({
    deviceRegistry: registry,
    e2eeKeypair: {
      publicKey: desktop.publicKey,
      secretKey: desktop.secretKey,
      publicKeyB64: Buffer.from(desktop.publicKey).toString('base64')
    },
    onText: vi.fn(),
    onBinary: vi.fn(),
    onClose: vi.fn(),
    onReady: (socket) => ready.push(socket),
    allowInsecureWebPairing: () => allowInsecureWebPairing
  })
  let relayDeviceId = ''
  wiring.attachTransport(transport, () =>
    relay ? relay(relayDeviceId) : { transport: 'direct', ...page }
  )

  function connect(auth: (transcriptHashB64: string) => Record<string, unknown>) {
    const ws = new FakeSocket()
    const peer = new SimulatedMobileE2EEV2Peer(
      nacl.box.keyPair(),
      desktop.publicKey,
      relay ? RELAY_HOST_ID : null
    )
    transport.receive(ws, JSON.stringify(peer.hello))
    expect(peer.acceptReady(JSON.parse(String(ws.sent[0])))).toBe(true)
    const transcriptHashB64 = peer.transcriptHashB64
    const before = ready.length
    transport.receive(
      ws,
      peer.sealText(
        JSON.stringify({ type: 'e2ee_auth', v: 2, transcriptHashB64, ...auth(transcriptHashB64) })
      )
    )
    const reply = ws.sent[1] ? JSON.parse(peer.openText(String(ws.sent[1]))!) : null
    return { ws, transcriptHashB64, reply, socket: ready.length > before ? ready.at(-1) : null }
  }
  return {
    registry,
    wiring,
    transport,
    connect,
    bindRelay: (deviceId: string) => (relayDeviceId = deviceId)
  }
}

function sign(key: nacl.SignKeyPair, purpose: 'auth' | 'register', transcriptHashB64: string) {
  const message = encodeDeviceProofMessage(purpose, Buffer.from(transcriptHashB64, 'base64'))
  return Buffer.from(nacl.sign.detached(message, key.secretKey)).toString('base64')
}

describe('pairing from a plain-http page on another machine', () => {
  it('refuses a first pairing without operator opt-in, with a sealed reason', () => {
    const { registry, connect } = harness(WEB_CLIENT)
    const pending = registry.getOrCreatePendingDevice('Browser', 'runtime')
    const attempt = connect(() => ({ deviceToken: pending.token }))
    expect(attempt.reply).toEqual({ type: 'e2ee_error', error: { code: 'insecure_origin' } })
    expect(attempt.socket).toBeNull()
    expect(attempt.ws.close).toHaveBeenCalledWith(4001, 'Insecure web origin')
    expect(registry.getDevice(pending.deviceId)?.lastSeenAt).toBe(0)
  })

  it('pairs when the operator opted in', () => {
    const { registry, connect } = harness(WEB_CLIENT, true)
    const pending = registry.getOrCreatePendingDevice('Browser', 'runtime')
    expect(connect(() => ({ deviceToken: pending.token })).reply).toMatchObject({
      type: 'e2ee_authenticated'
    })
  })

  it('never cuts a browser that was already paired', () => {
    const { registry, connect } = harness(WEB_CLIENT)
    const paired = registry.addDevice('Browser', 'runtime')
    registry.updateLastSeen(paired.deviceId)
    expect(connect(() => ({ deviceToken: paired.token })).reply).toMatchObject({
      type: 'e2ee_authenticated'
    })
  })

  it('lets https, loopback and native clients pair as before', () => {
    for (const page of [
      { webOrigin: 'https://desk.example.com', webClient: true as const },
      { webOrigin: 'http://localhost:6768', webClient: true as const },
      undefined
    ]) {
      const { registry, connect } = harness(page)
      const pending = registry.getOrCreatePendingDevice('Client', 'runtime')
      expect(connect(() => ({ deviceToken: pending.token })).reply).toMatchObject({
        type: 'e2ee_authenticated'
      })
    }
  })
})

describe('phones over direct LAN are never gated by their Origin', () => {
  it('pairs a released phone whose socket sends an http LAN Origin but no web marker', () => {
    for (const scope of ['mobile', 'runtime'] as const) {
      const { registry, connect } = harness({ webOrigin: LAN_PAGE })
      const pending = registry.getOrCreatePendingDevice('Phone', scope)
      expect(connect(() => ({ deviceToken: pending.token })).reply).toMatchObject({
        type: 'e2ee_authenticated'
      })
    }
  })
})

describe('relayed phones are never gated', () => {
  it('pairs over Relay whatever the page marker says', () => {
    const { registry, connect, bindRelay } = harness(WEB_CLIENT, false, (relayDeviceId) => ({
      transport: 'relay',
      relayHostId: RELAY_HOST_ID,
      relayDeviceId,
      basisConnId: 'conn',
      credentialKind: 'invite'
    }))
    const pending = registry.getOrCreatePendingDevice('Phone', 'mobile')
    bindRelay(pending.deviceId)
    expect(connect(() => ({ deviceToken: pending.token })).reply).toMatchObject({
      type: 'e2ee_authenticated'
    })
  })
})

describe('session-only browser keys', () => {
  it('registers an ephemeral row, sweeps it once idle and disconnected, and then revokes it', () => {
    const { registry, wiring, transport, connect } = harness({
      webOrigin: 'https://desk.example.com',
      webClient: true as const
    })
    const paired = registry.addDevice('Browser', 'runtime')
    registry.updateLastSeen(paired.deviceId)
    const migrating = connect(() => ({ deviceToken: paired.token }))
    const key = nacl.sign.keyPair()
    const fork = registerSocketDeviceKey(registry, migrating.socket!, {
      devicePublicKeyB64: Buffer.from(key.publicKey).toString('base64'),
      deviceProofB64: sign(key, 'register', migrating.transcriptHashB64),
      ephemeral: true
    })
    expect(registry.getDevice(fork.deviceId)?.ephemeral).toBe(true)

    const keyed = connect((hash) => ({
      deviceId: fork.deviceId,
      deviceProofB64: sign(key, 'auth', hash)
    }))
    expect(keyed.reply).toMatchObject({ type: 'e2ee_authenticated' })
    const idle = registry.getDevice(fork.deviceId)!.lastSeenAt + EPHEMERAL_DEVICE_IDLE_MS + 1
    // A live socket keeps the row however long the tab stays open.
    expect(wiring.sweepIdleEphemeralDevices(idle)).toEqual([])

    transport.receive(keyed.ws, 'ignored')
    wiring.dispose()
    expect(registry.pruneIdleEphemeralDevices(idle, () => false)).toEqual([fork.deviceId])
    const after = connect((hash) => ({
      deviceId: fork.deviceId,
      deviceProofB64: sign(key, 'auth', hash)
    }))
    expect(after.reply).toEqual({
      type: 'e2ee_error',
      error: { code: 'device_revoked', deviceId: fork.deviceId }
    })
  })

  it('cuts sockets bound to a swept row', () => {
    const { registry, wiring, transport } = harness(undefined)
    const paired = registry.addDevice('Browser', 'runtime')
    registry.updateLastSeen(paired.deviceId)
    const key = nacl.sign.keyPair()
    const fork = registry.forkDeviceKey(
      paired.deviceId,
      Buffer.from(key.publicKey).toString('base64'),
      'Tab',
      { ephemeral: true }
    )
    expect(
      wiring.sweepIdleEphemeralDevices(fork.lastSeenAt + EPHEMERAL_DEVICE_IDLE_MS + 1)
    ).toEqual([fork.deviceId])
    expect(transport.terminateClientConnections).toHaveBeenCalledWith(fork.deviceId)
    expect(registry.getDevice(paired.deviceId)).not.toBeNull()
    wiring.dispose()
  })
})

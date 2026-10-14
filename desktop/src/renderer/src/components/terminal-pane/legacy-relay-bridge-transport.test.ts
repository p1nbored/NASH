import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegacyRelayBridgedPane } from '../../../../shared/legacy-relay-bridge-contract'
import type { PtyTransport } from './pty-transport-types'

const PTY = 'ssh:ssh-box@@pty-1'

const bridge = vi.hoisted(() => ({
  attach: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  detach: vi.fn(),
  listPanes: vi.fn(async (): Promise<LegacyRelayBridgedPane[]> => []),
  panes: new Set<(panes: LegacyRelayBridgedPane[]) => void>(),
  data: new Set<(event: { ptyId: string; data: string }) => void>(),
  exit: new Set<(event: { ptyId: string; code: number }) => void>()
}))

vi.stubGlobal('window', {
  api: {
    legacyRelayBridge: {
      listPanes: bridge.listPanes,
      attach: bridge.attach,
      write: bridge.write,
      resize: bridge.resize,
      detach: bridge.detach,
      onPanes: (listener: (panes: LegacyRelayBridgedPane[]) => void) => {
        bridge.panes.add(listener)
        return () => bridge.panes.delete(listener)
      },
      onData: (listener: (event: { ptyId: string; data: string }) => void) => {
        bridge.data.add(listener)
        return () => bridge.data.delete(listener)
      },
      onExit: (listener: (event: { ptyId: string; code: number }) => void) => {
        bridge.exit.add(listener)
        return () => bridge.exit.delete(listener)
      }
    }
  }
})

const { createLegacyRelayBridgeTransport: createTransport } =
  await import('./legacy-relay-bridge-transport')
const { legacyRelayBridgePtyIdForPane } = await import('./legacy-relay-bridge-panes')

const created: PtyTransport[] = []
function createLegacyRelayBridgeTransport(ptyId: string, inner: PtyTransport): PtyTransport {
  const transport = createTransport(ptyId, inner)
  created.push(transport)
  return transport
}

function publishPanes(panes: LegacyRelayBridgedPane[]): void {
  bridge.panes.forEach((listener) => listener(panes))
}

function innerTransport(): PtyTransport {
  return {
    connect: vi.fn(async () => 'remote:env-1@@t-1'),
    attach: vi.fn(),
    disconnect: vi.fn(),
    sendInput: vi.fn(() => true),
    sendInputImmediate: vi.fn(() => true),
    resize: vi.fn(() => true),
    isConnected: vi.fn(() => true),
    getPtyId: vi.fn(() => 'remote:env-1@@t-1')
  }
}

function callbacks() {
  return {
    onConnect: vi.fn(),
    onData: vi.fn(),
    onReplayData: vi.fn(),
    onError: vi.fn(),
    onErrorCleared: vi.fn(),
    onExit: vi.fn()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  publishPanes([])
})

afterEach(async () => {
  await Promise.all(created.splice(0).map((transport) => transport.destroy?.()))
})

describe('a runtime pane bridged to an older relay’s terminal', () => {
  it('finds a pane mirrored from the managed server by its host tab and leaf', () => {
    publishPanes([
      { ptyId: PTY, targetId: 'ssh-box', tabId: 'tab-1', leafId: 'leaf-1', state: 'live' }
    ])
    const mirrored = `web-terminal-${encodeURIComponent('tab-1::leaf-1')}`
    expect(legacyRelayBridgePtyIdForPane({ tabId: mirrored, leafId: 'x', boundPtyId: null })).toBe(
      PTY
    )
    const other = `web-terminal-${encodeURIComponent('tab-1::leaf-2')}`
    expect(
      legacyRelayBridgePtyIdForPane({ tabId: other, leafId: 'x', boundPtyId: null })
    ).toBeNull()
  })

  it('never lets a second pane, such as a later split, drive the same old shell', () => {
    publishPanes([{ ptyId: PTY, targetId: 'ssh-box', tabId: 'tab-7', state: 'live' }])
    const mirrored = `web-terminal-${encodeURIComponent('tab-7::leaf-a')}`
    expect(legacyRelayBridgePtyIdForPane({ tabId: mirrored, leafId: 'p1', boundPtyId: null })).toBe(
      PTY
    )
    // The same pane remounting keeps it; another pane in that tab gets its own shell.
    expect(legacyRelayBridgePtyIdForPane({ tabId: mirrored, leafId: 'p1', boundPtyId: null })).toBe(
      PTY
    )
    expect(
      legacyRelayBridgePtyIdForPane({ tabId: mirrored, leafId: 'p2', boundPtyId: null })
    ).toBeNull()
  })

  it('finds the pane main serves for its tab and leaf, or the ssh id it still names', () => {
    publishPanes([
      { ptyId: PTY, targetId: 'ssh-box', tabId: 'tab-1', leafId: 'leaf-1', state: 'live' }
    ])
    expect(
      legacyRelayBridgePtyIdForPane({ tabId: 'tab-1', leafId: 'leaf-1', boundPtyId: null })
    ).toBe(PTY)
    expect(
      legacyRelayBridgePtyIdForPane({ tabId: 'tab-1', leafId: 'leaf-2', boundPtyId: null })
    ).toBeNull()
    expect(
      legacyRelayBridgePtyIdForPane({
        tabId: 'tab-9',
        leafId: 'leaf-9',
        boundPtyId: 'ssh:other@@pty-7'
      })
    ).toBe('ssh:other@@pty-7')
    expect(
      legacyRelayBridgePtyIdForPane({
        tabId: 'tab-9',
        leafId: 'leaf-9',
        boundPtyId: 'remote:env@@t'
      })
    ).toBeNull()
  })

  it('reattaches with the relay’s screen, then carries input, output, size and exit', async () => {
    bridge.attach.mockResolvedValue({ status: 'attached', replay: 'SCREEN' })
    const inner = innerTransport()
    const transport = createLegacyRelayBridgeTransport(PTY, inner)
    const cb = callbacks()
    await expect(transport.connect({ url: '', sessionId: PTY, callbacks: cb })).resolves.toEqual({
      id: PTY,
      isReattach: true,
      replay: 'SCREEN'
    })
    expect(transport.getPtyId()).toBe(PTY)
    expect(transport.sendInput('ls\r', 'driving')).toBe(true)
    expect(bridge.write).toHaveBeenCalledWith({ ptyId: PTY, data: 'ls\r' })
    transport.resize(100, 30)
    expect(bridge.resize).toHaveBeenCalledWith({ ptyId: PTY, cols: 100, rows: 30 })
    bridge.data.forEach((listener) => listener({ ptyId: PTY, data: 'out' }))
    bridge.data.forEach((listener) => listener({ ptyId: 'ssh:ssh-box@@pty-2', data: 'other' }))
    expect(cb.onData.mock.calls).toEqual([['out']])
    bridge.exit.forEach((listener) => listener({ ptyId: PTY, code: 0 }))
    expect(cb.onExit).toHaveBeenCalledWith(0)
    expect(bridge.detach).toHaveBeenCalledWith({ ptyId: PTY })
    expect(inner.connect).not.toHaveBeenCalled()
  })

  it('reports a terminal the relay no longer runs as an expired session, then spawns on orcad', async () => {
    bridge.attach.mockResolvedValue({ status: 'exited' })
    const inner = innerTransport()
    const transport = createLegacyRelayBridgeTransport(PTY, inner)
    const cb = callbacks()
    await expect(transport.connect({ url: '', sessionId: PTY, callbacks: cb })).resolves.toBe(
      undefined
    )
    expect(cb.onError.mock.calls[0][0]).toContain('SSH_SESSION_EXPIRED')
    await transport.connect({ url: '', callbacks: cb })
    expect(inner.connect).toHaveBeenCalledTimes(1)
    expect(transport.getPtyId()).toBe('remote:env-1@@t-1')
  })

  it('keeps an unreachable terminal bound and reattaches once the relay answers', async () => {
    bridge.attach.mockResolvedValueOnce({ status: 'unverifiable' })
    const transport = createLegacyRelayBridgeTransport(PTY, innerTransport())
    const cb = callbacks()
    await expect(transport.connect({ url: '', sessionId: PTY, callbacks: cb })).resolves.toEqual({
      id: PTY,
      isReattach: true,
      replay: ''
    })
    expect(cb.onError).toHaveBeenCalledTimes(1)
    expect(cb.onExit).not.toHaveBeenCalled()
    bridge.attach.mockResolvedValueOnce({ status: 'attached', replay: 'BACK' })
    publishPanes([{ ptyId: PTY, targetId: 'ssh-box', tabId: 'tab-1', state: 'live' }])
    await vi.waitFor(() =>
      expect(cb.onReplayData).toHaveBeenCalledWith('BACK', { clearBeforeReplay: true })
    )
    expect(cb.onErrorCleared).toHaveBeenCalledTimes(1)
  })

  it('reattaches after a disconnect hung the bridge up, so the pane is never left deaf', async () => {
    bridge.attach.mockResolvedValueOnce({ status: 'attached', replay: 'SCREEN' })
    const transport = createLegacyRelayBridgeTransport(PTY, innerTransport())
    const cb = callbacks()
    await transport.connect({ url: '', sessionId: PTY, callbacks: cb })
    const live: LegacyRelayBridgedPane = {
      ptyId: PTY,
      targetId: 'ssh-box',
      tabId: 'tab-1',
      state: 'live'
    }
    publishPanes([live])
    // A disconnect stops the bridge, which publishes no panes and reports no exit.
    bridge.attach.mockResolvedValueOnce({ status: 'unverifiable' })
    publishPanes([])
    await vi.waitFor(() => expect(bridge.attach).toHaveBeenCalledTimes(2))
    expect(transport.sendInput('lost\r', 'driving')).toBe(false)
    expect(cb.onExit).not.toHaveBeenCalled()
    // Main's new bridge forwards output only to a pane that attached to it.
    bridge.attach.mockResolvedValueOnce({ status: 'attached', replay: 'BACK' })
    publishPanes([live])
    await vi.waitFor(() =>
      expect(cb.onReplayData).toHaveBeenCalledWith('BACK', { clearBeforeReplay: true })
    )
    expect(transport.sendInput('ls\r', 'driving')).toBe(true)
  })

  it('asks again for a pane that turned live while an earlier ask was still out', async () => {
    bridge.attach.mockResolvedValueOnce({ status: 'attached', replay: 'SCREEN' })
    const transport = createLegacyRelayBridgeTransport(PTY, innerTransport())
    const cb = callbacks()
    await transport.connect({ url: '', sessionId: PTY, callbacks: cb })
    let answerFirst: (result: { status: 'unverifiable' }) => void = () => {}
    bridge.attach.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
    publishPanes([])
    await vi.waitFor(() => expect(bridge.attach).toHaveBeenCalledTimes(2))
    // The replacement bridge lists the pane live before the ask its predecessor took answers.
    publishPanes([{ ptyId: PTY, targetId: 'ssh-box', tabId: 'tab-1', state: 'live' }])
    bridge.attach.mockResolvedValueOnce({ status: 'attached', replay: 'BACK' })
    answerFirst({ status: 'unverifiable' })
    await vi.waitFor(() =>
      expect(cb.onReplayData).toHaveBeenCalledWith('BACK', { clearBeforeReplay: true })
    )
    expect(transport.isConnected()).toBe(true)
  })

  it('ends a pane it was still waiting on once the relay proves the terminal gone', async () => {
    bridge.attach.mockResolvedValueOnce({ status: 'unverifiable' })
    const transport = createLegacyRelayBridgeTransport(PTY, innerTransport())
    const cb = callbacks()
    await transport.connect({ url: '', sessionId: PTY, callbacks: cb })
    bridge.attach.mockResolvedValueOnce({ status: 'exited' })
    publishPanes([])
    await vi.waitFor(() => expect(cb.onExit).toHaveBeenCalledWith(-1))
  })

  it('hands any other connect straight to the managed server’s transport', async () => {
    const inner = innerTransport()
    const transport = createLegacyRelayBridgeTransport(PTY, inner)
    await transport.connect({ url: '', sessionId: 'remote:env-1@@t-1', callbacks: callbacks() })
    expect(bridge.attach).not.toHaveBeenCalled()
    expect(inner.connect).toHaveBeenCalledTimes(1)
  })
})

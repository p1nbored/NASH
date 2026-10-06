/* AC-TERM-01 lifecycle on real Windows ConPTY: reload, quit/relaunch, daemon shutdown, close, exit. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DaemonClient } from './client'
import { probeSocketConnect } from './daemon-endpoint-probe'
import { waitForEndpointUnreachable } from './daemon-endpoint-reachability-test-harness'
import { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonServer } from './daemon-server'
import { getDaemonSocketPath } from './daemon-spawner'
import {
  coldRestoreSeed,
  countOccurrences,
  createAcceptanceSpawner,
  isProcessAlive,
  mountAcceptancePane,
  openAcceptancePane,
  refuseProcessTableShellScan,
  toHex,
  waitForDaemonSnapshot,
  waitUntil,
  type AcceptanceSpawner,
  type MountedAcceptancePane
} from './terminal-acceptance-test-harness'

const SIZE = { cols: 120, rows: 30 }

function lineOf(seq: number, text: string): RegExp {
  return new RegExp(`^LINE ${seq} ${toHex(text)}$`)
}

describe.skipIf(process.platform !== 'win32')('AC-TERM-01 ConPTY lifecycle distinctions', () => {
  let restoreScan: () => void = () => {}
  let spawner: AcceptanceSpawner
  let dir: string
  let socketPath: string
  let tokenPath: string
  let server: DaemonServer
  let adapters: readonly DaemonPtyAdapter[] = []
  let panes: readonly MountedAcceptancePane[] = []
  let sessionCount = 0

  async function startServer(): Promise<DaemonServer> {
    const started = new DaemonServer({ socketPath, tokenPath, spawnSubprocess: spawner.spawn })
    await started.start()
    return started
  }

  /** One adapter per app launch, sharing the on-disk terminal history like a real profile. */
  function launchApp(): DaemonPtyAdapter {
    const adapter = new DaemonPtyAdapter({
      socketPath,
      tokenPath,
      historyPath: join(dir, 'history')
    })
    adapters = [...adapters, adapter]
    return adapter
  }

  function track<T extends MountedAcceptancePane>(pane: T): T {
    panes = [...panes, pane]
    return pane
  }

  async function connectObserver(): Promise<DaemonClient> {
    const observer = new DaemonClient({ socketPath, tokenPath })
    await observer.ensureConnected()
    return observer
  }

  function nextSessionId(): string {
    sessionCount += 1
    return `ac-term-life-${process.pid}-${sessionCount}`
  }

  beforeAll(() => {
    restoreScan = refuseProcessTableShellScan()
  })

  afterAll(() => restoreScan())

  beforeEach(async () => {
    spawner = createAcceptanceSpawner()
    dir = mkdtempSync(join(tmpdir(), 'ac-term-lifecycle-'))
    socketPath = getDaemonSocketPath(dir)
    tokenPath = join(dir, 'daemon.token')
    server = await startServer()
  })

  afterEach(async () => {
    for (const pane of panes) {
      pane.close()
    }
    for (const adapter of adapters) {
      adapter.dispose()
    }
    panes = []
    adapters = []
    await server.shutdown()
    rmSync(dir, { recursive: true, force: true })
    await waitUntil(() => spawner.pids.every((pid) => !isProcessAlive(pid)), 'children reaped')
  })

  it('renderer reload reattaches the same child with a snapshot and one live stream', async () => {
    const app = launchApp()
    const id = nextSessionId()
    const first = track(await openAcceptancePane(app, id, SIZE))
    app.write(id, 'before reload\r')
    await first.mirror.waitForLine(lineOf(1, 'before reload'), 'pre-reload line')
    first.close()

    const reloaded = track(mountAcceptancePane(app, id, SIZE, { awaitSeed: true }))
    const result = await app.spawn({ ...SIZE, sessionId: id })
    reloaded.seed(result.snapshot ?? '')
    app.write(id, 'after reload\r')
    await reloaded.mirror.waitForLine(lineOf(2, 'after reload'), 'post-reload line')

    expect(result).toMatchObject({ isReattach: true, pid: first.pid })
    expect(result.coldRestore).toBeUndefined()
    expect(reloaded.mirror.logicalLines()).toContain(`LINE 1 ${toHex('before reload')}`)
    // Why: pre-reload bytes reach the new view only through the snapshot, never replayed live.
    expect(reloaded.stream).not.toContain('LINE 1 ')
    expect(countOccurrences(reloaded.stream, 'LINE 2 ')).toBe(1)
  })

  it('app quit keeps the child alive and relaunch reattaches warm with no loss or replay', async () => {
    const appA = launchApp()
    const id = nextSessionId()
    const before = track(await openAcceptancePane(appA, id, SIZE))
    appA.write(id, 'before quit\r')
    await before.mirror.waitForLine(lineOf(1, 'before quit'), 'pre-quit line')
    appA.write(id, 'ticks 3 1500\r')
    await before.mirror.waitForLine(lineOf(2, 'ticks 3 1500'), 'ticks scheduled')
    before.close()

    await appA.disconnectOnly()
    const typedAfterQuit = appA.write(id, 'typed after quit\r')
    const endpointAfterQuit = await probeSocketConnect(socketPath)
    const observer = await connectObserver()
    const atQuit = await waitForDaemonSnapshot(observer, id, () => true, 'quit snapshot')
    const detached = await waitForDaemonSnapshot(
      observer,
      id,
      (snapshot) => snapshot.snapshotAnsi.includes('TICK 3'),
      'output produced while detached'
    )
    observer.disconnect()

    const appB = launchApp()
    const relaunched = track(mountAcceptancePane(appB, id, SIZE, { awaitSeed: true }))
    const result = await appB.spawn({ cols: 90, rows: 25, sessionId: id })
    relaunched.seed(result.snapshot ?? '')
    appB.write(id, 'after relaunch\r')
    await relaunched.mirror.waitForLine(lineOf(3, 'after relaunch'), 'post-relaunch line')

    expect(typedAfterQuit).toBe(false)
    expect(endpointAfterQuit).toBe('connected')
    expect(atQuit.snapshotAnsi).not.toContain('TICK')
    expect(detached.snapshotAnsi).toContain('TICK 1')
    // Why: an attach asking for 90x25 must not steal the writer's 120x30 grid; it mirrors it.
    expect(result).toMatchObject({
      isReattach: true,
      pid: before.pid,
      snapshotCols: SIZE.cols,
      snapshotRows: SIZE.rows
    })
    expect(result.coldRestore).toBeUndefined()
    await expect(appB.getAppliedSize(id)).resolves.toEqual(SIZE)
    expect(relaunched.mirror.logicalLines()).toEqual(
      expect.arrayContaining(['TICK 1', 'TICK 2', 'TICK 3'])
    )
    expect(relaunched.stream).not.toContain('TICK')
    expect(relaunched.mirror.logicalLines().join('\n')).not.toContain(toHex('typed after quit'))
    expect(countOccurrences(relaunched.stream, 'LINE 3 ')).toBe(1)
  })

  it('daemon shutdown terminates the child and the next launch cold-restores a new one', async () => {
    const appA = launchApp()
    const id = nextSessionId()
    const before = track(await openAcceptancePane(appA, id, SIZE))
    appA.write(id, `show ${toHex('BEFORE-SHUTDOWN')}\r`)
    await before.mirror.waitForLine(/^SHOW BEFORE-SHUTDOWN$/, 'pre-shutdown output')
    before.close()
    await appA.disconnectOnly()

    const observer = await connectObserver()
    await observer.request('shutdown', { killSessions: true }).catch(() => {
      // The daemon may close the socket before its reply lands; the kill already ran.
    })
    observer.disconnect()
    await waitUntil(() => !isProcessAlive(before.pid), 'child terminated by daemon shutdown')
    await server.shutdown()
    server = await startServer()

    const appB = launchApp()
    const restored = track(mountAcceptancePane(appB, id, SIZE, { awaitSeed: true }))
    const result = await appB.spawn({ ...SIZE, sessionId: id })
    restored.seed(coldRestoreSeed(result.coldRestore?.scrollback ?? '', SIZE.rows))
    await restored.mirror.waitForLine(/^READY \d+x\d+$/, 'fresh child')
    appB.write(id, 'after restore\r')
    await restored.mirror.waitForLine(lineOf(1, 'after restore'), 'first line of new child')

    expect(result.isReattach).toBeFalsy()
    expect(result.coldRestore?.scrollback).toContain('SHOW BEFORE-SHUTDOWN')
    expect(result.pid).not.toBe(before.pid)
    expect(isProcessAlive(Number(result.pid))).toBe(true)
    // Why: history is read-only scrollback; the new process never re-receives the old input.
    expect(restored.mirror.normalLines().filter((line) => line === 'SHOW BEFORE-SHUTDOWN')).toEqual(
      ['SHOW BEFORE-SHUTDOWN']
    )
    expect(restored.stream).not.toContain('BEFORE-SHUTDOWN')
  })

  it('closing a terminal kills the child, emits exit, and is never reattached or restored', async () => {
    const appA = launchApp()
    const exits: { id: string; code: number }[] = []
    appA.onExit((event) => exits.push(event))
    const id = nextSessionId()
    const opened = track(await openAcceptancePane(appA, id, SIZE))
    appA.write(id, `show ${toHex('BEFORE-CLOSE')}\r`)
    await opened.mirror.waitForLine(/^SHOW BEFORE-CLOSE$/, 'pre-close output')

    await appA.shutdown(id, { immediate: false })
    await waitUntil(() => exits.some((event) => event.id === id), 'exit event')
    await waitUntil(() => !isProcessAlive(opened.pid), 'child terminated by close')

    expect(await appA.probePtyLiveness(id)).toBe(false)
    await expect(appA.spawn({ ...SIZE, sessionId: id })).rejects.toThrow('explicitly killed')
    await appA.disconnectOnly()
    // Why: with no live terminal left, quitting lets the idle daemon retire; relaunch starts one.
    await expect(waitForEndpointUnreachable(socketPath)).resolves.toBe(true)
    await server.shutdown()
    server = await startServer()
    const appB = launchApp()
    const reopened = await appB.spawn({ ...SIZE, sessionId: id })
    expect(reopened.isReattach).toBeFalsy()
    expect(reopened.coldRestore).toBeUndefined()
    expect(reopened.pid).not.toBe(opened.pid)
  })

  it('a child that exits on its own reports its exit code and is not respawned', async () => {
    const app = launchApp()
    const exits: { id: string; code: number }[] = []
    app.onExit((event) => exits.push(event))
    const id = nextSessionId()
    const opened = track(await openAcceptancePane(app, id, SIZE))

    app.write(id, 'exit 3\r')
    await waitUntil(() => exits.some((event) => event.id === id), 'exit event')

    expect(exits.filter((event) => event.id === id)).toEqual([expect.objectContaining({ code: 3 })])
    await waitUntil(() => !isProcessAlive(opened.pid), 'child gone')
    expect(await app.probePtyLiveness(id)).toBe(false)
    expect(app.hasPty(id)).toBe(false)
  })
})

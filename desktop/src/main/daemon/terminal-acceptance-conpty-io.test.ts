/* AC-TERM-01 on real Windows ConPTY: DaemonPtyAdapter -> DaemonServer -> Session -> node child. */
import { rmSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DaemonClient } from './client'
import {
  startDaemonAdapterHarness,
  type DaemonAdapterHarness
} from './daemon-pty-adapter-test-harness'
import {
  countOccurrences,
  createAcceptanceSpawner,
  isProcessAlive,
  openAcceptancePane,
  readDaemonSnapshot,
  refuseProcessTableShellScan,
  toHex,
  waitUntil,
  type AcceptancePane,
  type AcceptanceSpawner
} from './terminal-acceptance-test-harness'

const SIZE = { cols: 160, rows: 30 }
// CJK, emoji (surrogate pair), e + combining acute, and right-to-left Hebrew.
const UNICODE_SAMPLE = '中文 \u{1F600} é שלום'

function rawInputHex(pane: AcceptancePane): string {
  return pane.mirror
    .logicalLines()
    .flatMap((line) => line.match(/^RAW ([0-9a-f]+)$/)?.slice(1) ?? [])
    .join('')
}

describe.skipIf(process.platform !== 'win32')('AC-TERM-01 ConPTY I/O through the daemon', () => {
  let restoreScan: () => void = () => {}
  let spawner: AcceptanceSpawner
  let harness: DaemonAdapterHarness
  let observer: DaemonClient
  let pane: AcceptancePane | null = null
  let paneCount = 0

  beforeAll(() => {
    restoreScan = refuseProcessTableShellScan()
  })

  afterAll(() => restoreScan())

  beforeEach(async () => {
    spawner = createAcceptanceSpawner()
    harness = await startDaemonAdapterHarness(spawner.spawn)
    observer = new DaemonClient({ socketPath: harness.socketPath, tokenPath: harness.tokenPath })
    await observer.ensureConnected()
  })

  afterEach(async () => {
    pane?.close()
    pane = null
    observer.disconnect()
    harness.adapter.dispose()
    await harness.server.shutdown()
    rmSync(harness.dir, { recursive: true, force: true })
    // Why: a daemon shutdown that orphans its ConPTY child is a lifecycle failure, not cleanup noise.
    await waitUntil(() => spawner.pids.every((pid) => !isProcessAlive(pid)), 'children reaped')
  })

  async function open(): Promise<AcceptancePane> {
    paneCount += 1
    pane = await openAcceptancePane(harness.adapter, `ac-term-io-${process.pid}-${paneCount}`, SIZE)
    return pane
  }

  it('spawns node under ConPTY at the requested geometry without typing anything', async () => {
    const opened = await open()

    expect(isProcessAlive(opened.pid)).toBe(true)
    expect(opened.mirror.logicalLines()).toContain(`READY ${SIZE.cols}x${SIZE.rows}`)
    await expect(harness.adapter.getAppliedSize(opened.id)).resolves.toEqual(SIZE)
    expect(opened.stream).not.toMatch(/LINE \d+ /)
  })

  it('round-trips typed input to the child exactly once', async () => {
    const opened = await open()

    harness.adapter.write(opened.id, 'hello acceptance\r')

    await opened.mirror.waitForLine(new RegExp(`^LINE 1 ${toHex('hello acceptance')}$`), 'line')
    expect(countOccurrences(opened.stream, 'LINE 1 ')).toBe(1)
    expect(opened.stream).not.toContain('LINE 2 ')
  })

  it('round-trips CJK, emoji, combining marks and RTL text in both directions', async () => {
    const opened = await open()

    harness.adapter.write(opened.id, `${UNICODE_SAMPLE}\r`)
    await opened.mirror.waitForLine(new RegExp(`^LINE 1 ${toHex(UNICODE_SAMPLE)}$`), 'input')
    harness.adapter.write(opened.id, `show ${toHex(UNICODE_SAMPLE)}\r`)
    await opened.mirror.waitForLine(/^SHOW /, 'output')

    expect(opened.mirror.logicalLines()).toContain(`SHOW ${UNICODE_SAMPLE}`)
    expect(opened.stream).not.toContain('LINE 3 ')
    const snapshot = await readDaemonSnapshot(observer, opened.id)
    expect(snapshot.snapshotAnsi).toContain(`SHOW ${UNICODE_SAMPLE}`)
  })

  it('delivers a renderer paste with bracket markers once the child enables mode 2004', async () => {
    const opened = await open()
    harness.adapter.write(opened.id, 'paste-on\r')
    await opened.mirror.waitForLine(/^PASTE-ON$/, 'paste mode')
    expect(opened.mirror.terminal.modes.bracketedPasteMode).toBe(true)
    expect((await readDaemonSnapshot(observer, opened.id)).modes.bracketedPaste).toBe(true)
    harness.adapter.write(opened.id, 'raw\r')
    await opened.mirror.waitForLine(/^RAW-ON$/, 'raw mode')

    const payload = opened.mirror.pastePayload(`first line\nsecond ${UNICODE_SAMPLE}`)
    harness.adapter.write(opened.id, payload)

    expect(payload.startsWith('\x1b[200~') && payload.endsWith('\x1b[201~')).toBe(true)
    await waitUntil(() => rawInputHex(opened).length >= toHex(payload).length, 'paste bytes')
    expect(rawInputHex(opened)).toBe(toHex(payload))
  })

  it('delivers Ctrl+C as SIGINT without killing the child or the session', async () => {
    const opened = await open()

    harness.adapter.write(opened.id, '\x03')
    await opened.mirror.waitForLine(/^SIGINT 1$/, 'first SIGINT')
    harness.adapter.write(opened.id, '\x03')
    await opened.mirror.waitForLine(/^SIGINT 2$/, 'second SIGINT')
    harness.adapter.write(opened.id, 'after interrupt\r')

    await opened.mirror.waitForLine(new RegExp(`^LINE 1 ${toHex('after interrupt')}$`), 'line')
    expect(countOccurrences(opened.stream, 'SIGINT ')).toBe(2)
    expect(opened.stream).not.toContain('LINE 2 ')
    expect(isProcessAlive(opened.pid)).toBe(true)
    await expect(harness.adapter.probePtyLiveness(opened.id)).resolves.toBe(true)
  })

  it('applies the writer geometry to the child, the daemon emulator and the mirror', async () => {
    const opened = await open()
    harness.adapter.write(opened.id, 'raw\r')
    await opened.mirror.waitForLine(/^RAW-ON$/, 'raw mode')

    for (const size of [
      { cols: 100, rows: 40 },
      { cols: 72, rows: 20 }
    ]) {
      opened.mirror.resize(size.cols, size.rows)
      harness.adapter.resize(opened.id, size.cols, size.rows)
      await opened.mirror.waitForLine(new RegExp(`^RESIZE ${size.cols}x${size.rows}$`), 'resize')
      await expect(harness.adapter.getAppliedSize(opened.id)).resolves.toEqual(size)
      const snapshot = await readDaemonSnapshot(observer, opened.id)
      expect({ cols: snapshot.cols, rows: snapshot.rows }).toEqual(size)
    }
    // Why: a raw-mode TUI owns Ctrl+C as a byte; only processed input turns it into SIGINT.
    harness.adapter.write(opened.id, '\x03')
    await opened.mirror.waitForLine(/^RAW 03$/, 'raw Ctrl+C')
    expect(opened.stream).not.toContain('SIGINT')
  })

  it('enters and leaves the alternate screen in the daemon emulator and the mirror', async () => {
    const opened = await open()

    harness.adapter.write(opened.id, 'alt-on\r')
    await opened.mirror.waitForLine(/^ALT-SCREEN-FRAME$/, 'alternate frame')
    expect(opened.mirror.terminal.buffer.active.type).toBe('alternate')
    const inAlternate = await readDaemonSnapshot(observer, opened.id)
    expect(inAlternate.modes.alternateScreen).toBe(true)
    expect(inAlternate.snapshotAnsi).toContain('ALT-SCREEN-FRAME')
    expect(opened.mirror.normalLines()).toContain(`READY ${SIZE.cols}x${SIZE.rows}`)

    harness.adapter.write(opened.id, 'alt-off\r')
    await opened.mirror.waitForLine(/^ALT-OFF$/, 'normal screen')
    expect(opened.mirror.terminal.buffer.active.type).toBe('normal')
    const restored = await readDaemonSnapshot(observer, opened.id)
    expect(restored.modes.alternateScreen).toBe(false)
    expect(restored.snapshotAnsi).not.toContain('ALT-SCREEN-FRAME')
    expect(opened.mirror.logicalLines()).toContain(`READY ${SIZE.cols}x${SIZE.rows}`)
  })
})

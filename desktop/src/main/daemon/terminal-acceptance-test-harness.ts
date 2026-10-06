/* Real-ConPTY acceptance fixtures: Orca's daemon stack driving a node child, never a shell. */
import './xterm-env-polyfill'
import { Terminal } from '@xterm/headless'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activateOrcaTerminalUnicodeProvider } from '../../shared/terminal-unicode-provider'
import { __setWindowsProcessTableCimScanForTests } from '../windows/windows-process-table'
import type { DaemonClient } from './client'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { SpawnSubprocess } from './daemon-pty-adapter-test-harness'
import { spawnNativeDaemonPty } from './pty-subprocess/native-pty-spawn'
import { createDaemonPtyEnvironment } from './pty-subprocess/spawn-environment'
import { createDaemonPtySubprocessHandle } from './pty-subprocess/subprocess-handle'
import { installDeviceAttributesResponder } from './startup-device-attributes-responder'
import type { TerminalSnapshot } from './types'

export const ACCEPTANCE_CHILD_PATH = join(
  __dirname,
  '__fixtures__',
  'terminal-acceptance-child.mjs'
)
export const ACCEPTANCE_WAIT_MS = 10_000
// Why: same reply as HeadlessEmulator's CONPTY_DA1_RESPONSE and its renderer twin.
const CONPTY_DA1_RESPONSE = '\x1b[?61;4c'
const POLL_MS = 15

export function toHex(text: string): string {
  return Buffer.from(text, 'utf8').toString('hex')
}

export async function waitUntil(
  predicate: () => boolean,
  label: string,
  timeoutMs = ACCEPTANCE_WAIT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/** Without the windows-process-tree addon, teardown's identity probe forks powershell.exe; refuse it. */
export function refuseProcessTableShellScan(): () => void {
  __setWindowsProcessTableCimScanForTests(() =>
    Promise.reject(new Error('terminal acceptance refuses the powershell.exe process-table scan'))
  )
  return () => __setWindowsProcessTableCimScanForTests()
}

export type AcceptanceSpawner = {
  spawn: SpawnSubprocess
  readonly pids: readonly number[]
}

/** Why below the launch plan: Orca gives non-shell executables no argv, so the child enters at native spawn. */
export function createAcceptanceSpawner(): AcceptanceSpawner {
  let pids: readonly number[] = []
  const spawn: SpawnSubprocess = async (opts) => {
    if (opts.command !== undefined) {
      throw new Error('terminal acceptance never types a startup command for the user')
    }
    const env = createDaemonPtyEnvironment(opts)
    const spawned = await spawnNativeDaemonPty({
      shellPath: process.execPath,
      shellArgs: [ACCEPTANCE_CHILD_PATH],
      spawnCwd: opts.cwd || tmpdir(),
      env,
      cols: opts.cols,
      rows: opts.rows,
      windowsFallbackAttempts: []
    })
    pids = [...pids, spawned.process.pid]
    return createDaemonPtySubprocessHandle({
      process: spawned.process,
      shellPath: spawned.shellPath,
      spawnCwd: spawned.spawnCwd,
      env,
      startupCommandDeliveredInShellArgs: false,
      reportsChildExitStatus: spawned.reportsChildExitStatus,
      requestedCwd: opts.cwd,
      sessionId: opts.sessionId,
      startupAgentRecognition: null
    })
  }
  return {
    spawn,
    get pids() {
      return pids
    }
  }
}

/** Stands in for the renderer's xterm: same Unicode widths, answers ConPTY's startup DA1. */
export class AcceptanceRendererMirror {
  readonly terminal: Terminal

  constructor(cols: number, rows: number, sendInput: (data: string) => void) {
    this.terminal = new Terminal({ cols, rows, allowProposedApi: true, logLevel: 'off' })
    this.terminal.loadAddon(new Unicode11Addon())
    activateOrcaTerminalUnicodeProvider(this.terminal)
    installDeviceAttributesResponder({
      parser: this.terminal.parser,
      response: CONPTY_DA1_RESPONSE,
      reply: sendInput
    })
    this.terminal.onData(sendInput)
  }

  write(data: string): void {
    this.terminal.write(data)
  }

  flushed(): Promise<void> {
    return new Promise((resolve) => this.terminal.write('', resolve))
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows)
  }

  /** Rendered lines of the active buffer with soft wraps joined. */
  logicalLines(buffer = this.terminal.buffer.active): string[] {
    const lines: string[] = []
    for (let row = 0; row < buffer.length; row += 1) {
      const line = buffer.getLine(row)
      if (!line) {
        continue
      }
      const text = line.translateToString(true)
      if (line.isWrapped && lines.length > 0) {
        lines[lines.length - 1] += text
      } else {
        lines.push(text)
      }
    }
    return lines
  }

  normalLines(): string[] {
    return this.logicalLines(this.terminal.buffer.normal)
  }

  async waitForLine(pattern: RegExp, label: string): Promise<void> {
    await waitUntil(() => this.logicalLines().some((line) => pattern.test(line)), label)
    await this.flushed()
  }

  /** What xterm's paste() sends: CR line endings, bracketed only when the app enabled 2004. */
  pastePayload(text: string): string {
    const body = text.replace(/\r?\n/g, '\r')
    return this.terminal.modes.bracketedPasteMode ? `\x1b[200~${body}\x1b[201~` : body
  }

  dispose(): void {
    this.terminal.dispose()
  }
}

export type MountedAcceptancePane = {
  id: string
  mirror: AcceptanceRendererMirror
  /** Raw stream exactly as the adapter delivered it to this pane. */
  readonly stream: string
  /** Writes restored state, then releases live bytes held since mount (the renderer's replay order). */
  seed(ansi: string): void
  close(): void
}

export type AcceptancePane = MountedAcceptancePane & { pid: number }

/** Subscribes a renderer-like pane to one session id before any output can arrive. */
export function mountAcceptancePane(
  adapter: DaemonPtyAdapter,
  id: string,
  size: { cols: number; rows: number },
  opts: { awaitSeed?: boolean } = {}
): MountedAcceptancePane {
  let stream = ''
  let held: readonly string[] | null = opts.awaitSeed ? [] : null
  const mirror = new AcceptanceRendererMirror(size.cols, size.rows, (data) => {
    adapter.write(id, data)
  })
  const unsubscribe = adapter.onData((event) => {
    if (event.id !== id) {
      return
    }
    stream += event.data
    if (held) {
      held = [...held, event.data]
    } else {
      mirror.write(event.data)
    }
  })
  return {
    id,
    mirror,
    get stream() {
      return stream
    },
    seed(ansi) {
      mirror.write(ansi)
      for (const data of held ?? []) {
        mirror.write(data)
      }
      held = null
    },
    close() {
      unsubscribe()
      mirror.dispose()
    }
  }
}

export async function openAcceptancePane(
  adapter: DaemonPtyAdapter,
  id: string,
  size: { cols: number; rows: number }
): Promise<AcceptancePane> {
  const pane = mountAcceptancePane(adapter, id, size)
  const result = await adapter.spawn({ ...size, sessionId: id, isNewSession: true })
  if (typeof result.pid !== 'number') {
    pane.close()
    throw new Error(`daemon published no pid for ${id}`)
  }
  await pane.mirror.waitForLine(/^READY \d+x\d+$/, `${id} READY`)
  const pid = result.pid
  return {
    id: pane.id,
    pid,
    mirror: pane.mirror,
    get stream() {
      return pane.stream
    },
    seed: (ansi) => pane.seed(ansi),
    close: () => pane.close()
  }
}

/** Reads the daemon emulator's state through a non-attaching observer client. */
export async function readDaemonSnapshot(
  observer: DaemonClient,
  sessionId: string
): Promise<TerminalSnapshot> {
  const { snapshot } = await observer.request<{ snapshot: TerminalSnapshot | null }>(
    'getSnapshot',
    { sessionId }
  )
  if (!snapshot) {
    throw new Error(`daemon has no snapshot for ${sessionId}`)
  }
  return snapshot
}

export async function waitForDaemonSnapshot(
  observer: DaemonClient,
  sessionId: string,
  predicate: (snapshot: TerminalSnapshot) => boolean,
  label: string
): Promise<TerminalSnapshot> {
  const deadline = Date.now() + ACCEPTANCE_WAIT_MS
  for (;;) {
    const snapshot = await readDaemonSnapshot(observer, sessionId)
    if (predicate(snapshot)) {
      return snapshot
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4))
  }
}

/** Cold-restore seed as the renderer writes it (terminal-restored-viewport.ts; main must not import it). */
export function coldRestoreSeed(scrollback: string, rows: number): string {
  // Why: fresh ConPTY output paints at screen coordinates, so restored rows must leave the viewport first.
  return `\x1b[0m${scrollback}\x1b[?6l\x1b[r\x1b[${rows};1H${'\r\n'.repeat(rows)}\x1b[H`
}

export function countOccurrences(text: string, token: string): number {
  return text.split(token).length - 1
}

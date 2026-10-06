import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCodexExecutable, type CodexExecutable } from './codex-exec-executable'
import type { CodexExecRunOptions } from './codex-exec-run-options'
import type { CodexExecRequest } from './codex-exec-types'

// FIXTURE_ONLY: drives the scripted fake codex; no real CLI, model or credential is involved.
export const FAKE_CODEX_ENTRY = join(__dirname, '__fixtures__', 'fake-codex.mjs')

export type FakeStep =
  | { readonly event: Readonly<Record<string, unknown>> }
  | { readonly stdout: string }
  | { readonly stdoutParts: readonly string[]; readonly gapMs?: number }
  | { readonly stderr: string }
  | { readonly lastMessage: string }
  | { readonly bigLine: number; readonly bigLineType?: string }
  | { readonly delayMs: number }
  | { readonly hang: true }
  | { readonly grandchild: true; readonly lifetimeMs?: number; readonly inheritStdout?: boolean }
  | { readonly ready: true }
  | { readonly exit: number }

export type FakeReceived = {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdinBase64: string
  readonly envNames: readonly string[]
  readonly envValues: Readonly<Record<string, string>>
}

export type FakeCodexRun = {
  readonly root: string
  readonly worktree: string
  /** The directory runs are created in; the temp-directory rule is switched off for it in `options`. */
  readonly runsRoot: string
  readonly runId: string
  /** Where the module will create this run's directory; it does not exist until the run starts. */
  readonly runDir: string
  readonly executable: CodexExecutable
  readonly request: (overrides?: Record<string, unknown>) => CodexExecRequest
  readonly options: (overrides?: Partial<CodexExecRunOptions>) => CodexExecRunOptions
  readonly received: () => FakeReceived | null
  readonly grandchildPid: () => number | null
  /** True once the fake reached its `ready` step. */
  readonly ready: () => boolean
  readonly cleanup: () => void
}

export const fakeEvents = {
  threadStarted: (id = 'thread-fixture-1') => ({
    event: { type: 'thread.started', thread_id: id }
  }),
  turnStarted: () => ({ event: { type: 'turn.started' } }),
  agentMessage: (text = 'done') => ({
    event: { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text } }
  }),
  reasoning: (text = 'REASONING-SENTINEL') => ({
    event: { type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text } }
  }),
  turnCompleted: () => ({
    event: {
      type: 'turn.completed',
      usage: {
        input_tokens: 120,
        cached_input_tokens: 40,
        output_tokens: 30,
        reasoning_output_tokens: 10
      }
    }
  })
} as const

/** The steps of a clean run: thread, turn, one message, a final-message file, completion, exit 0. */
export function successSteps(lastMessage = 'final answer'): readonly FakeStep[] {
  return [
    fakeEvents.threadStarted(),
    fakeEvents.turnStarted(),
    fakeEvents.reasoning(),
    fakeEvents.agentMessage(lastMessage),
    { lastMessage },
    fakeEvents.turnCompleted(),
    { exit: 0 }
  ]
}

const RUN_ID = 'run-0001'

export function createFakeCodexRun(steps: readonly FakeStep[]): FakeCodexRun {
  const root = mkdtempSync(join(tmpdir(), 'codex-exec-run-'))
  const worktree = join(root, 'worktree')
  const runsRoot = join(root, 'runs')
  const runDir = join(runsRoot, RUN_ID)
  mkdirSync(worktree)
  mkdirSync(runsRoot)
  writeFileSync(join(worktree, 'fake-scenario.json'), JSON.stringify({ steps }))
  const executable = resolveCodexExecutable(
    { kind: 'node-entry', entryPath: FAKE_CODEX_ENTRY },
    { isElectron: false }
  )
  const readJson = (name: string): unknown | null => {
    const path = join(runDir, name)
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  }
  return {
    root,
    worktree,
    runsRoot,
    runId: RUN_ID,
    runDir,
    executable,
    request: (overrides = {}) => ({
      prompt: 'Fixture prompt: summarize the repository.',
      model: 'gpt-6-astra',
      effort: 'high',
      sandbox: 'read-only',
      worktreePath: worktree,
      runsRoot,
      runId: RUN_ID,
      ...overrides
    }),
    options: (overrides = {}) => ({
      executable,
      ...overrides,
      deps: {
        // The fixture lives under the OS temp directory, which the module would otherwise refuse.
        tempRoots: () => [],
        // The real process table is not read from tests; no snapshot means win32 proves only root exit.
        termination: { captureWindowsTree: async () => null },
        ...overrides.deps
      }
    }),
    received: () => {
      const value = readJson('fake-received.json')
      return value === null ? null : parseReceived(value)
    },
    grandchildPid: () => {
      const path = join(runDir, 'fake-grandchild.pid')
      return existsSync(path) ? Number(readFileSync(path, 'utf8')) : null
    },
    ready: () => existsSync(join(runDir, 'fake-ready')),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

function parseReceived(value: unknown): FakeReceived {
  if (typeof value !== 'object' || value === null) {
    throw new Error('fake-received.json is not an object')
  }
  const record: Record<string, unknown> = { ...value }
  return {
    argv: toStrings(record.argv),
    cwd: String(record.cwd),
    stdinBase64: String(record.stdinBase64),
    envNames: toStrings(record.envNames),
    envValues: toStringRecord(record.envValues)
  }
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function toStringRecord(value: unknown): Record<string, string> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]))
    : {}
}

/** True once the process is gone; `process.kill(pid, 0)` throws ESRCH for a dead pid. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

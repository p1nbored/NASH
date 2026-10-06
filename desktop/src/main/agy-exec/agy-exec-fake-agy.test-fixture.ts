import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LaunchTarget } from '../agent-exec-shared/launch-target'
import type { AgyExecRunOptions } from './agy-exec-run-options'
import type { AgyExecRequest } from './agy-exec-types'

// FIXTURE_ONLY: drives the scripted fake agy; no real CLI, model or credential is involved.
export const FAKE_AGY_ENTRY = join(__dirname, '__fixtures__', 'fake-agy.mjs')

export type FakeStep =
  | { readonly stdout: string }
  | { readonly stdoutParts: readonly string[]; readonly gapMs?: number }
  | { readonly stderr: string }
  | { readonly bigStdout: number }
  | { readonly delayMs: number }
  | { readonly hang: true }
  | { readonly grandchild: true; readonly lifetimeMs?: number; readonly inheritStdout?: boolean }
  | { readonly ready: true }
  | { readonly exit: number }

export type FakeReceived = {
  readonly pid: number
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdinBytes: number
  readonly envNames: readonly string[]
  readonly envValues: Readonly<Record<string, string>>
}

export type FakeAgyRun = {
  readonly root: string
  readonly worktree: string
  /** The directory runs are created in; the temp-directory rule is switched off for it in `options`. */
  readonly runsRoot: string
  readonly runId: string
  /** Where the module will create this run's directory; it does not exist until the run starts. */
  readonly runDir: string
  readonly executable: LaunchTarget
  readonly request: (overrides?: Record<string, unknown>) => AgyExecRequest
  readonly options: (overrides?: Partial<AgyExecRunOptions>) => AgyExecRunOptions
  readonly received: () => FakeReceived | null
  readonly grandchildPid: () => number | null
  /** True once the fake reached its `ready` step. */
  readonly ready: () => boolean
  readonly cleanup: () => void
}

/** The steps of a clean run: some stdout, then exit 0. */
export function successSteps(answer = 'final answer\n'): readonly FakeStep[] {
  return [{ stdout: answer }, { exit: 0 }]
}

const RUN_ID = 'run-0001'

export function createFakeAgyRun(steps: readonly FakeStep[]): FakeAgyRun {
  const root = mkdtempSync(join(tmpdir(), 'agy-exec-run-'))
  const worktree = join(root, 'worktree')
  const runsRoot = join(root, 'runs')
  const runDir = join(runsRoot, RUN_ID)
  mkdirSync(worktree)
  mkdirSync(runsRoot)
  writeFileSync(join(worktree, 'fake-scenario.json'), JSON.stringify({ steps }))
  const executable: LaunchTarget = {
    program: process.execPath,
    prefixArgs: [FAKE_AGY_ENTRY],
    entryPath: FAKE_AGY_ENTRY,
    requestedPath: FAKE_AGY_ENTRY,
    launch: 'node-entry',
    electronRunAsNode: false
  }
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
      prompt: 'Fixture prompt: draft a short release note.',
      model: 'gemini-3.8-flash-high',
      worktreePath: worktree,
      runsRoot,
      runId: RUN_ID,
      sandbox: true,
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
    pid: Number(record.pid),
    argv: toStrings(record.argv),
    cwd: String(record.cwd),
    stdinBytes: Number(record.stdinBytes),
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

/** True while the process lives; `process.kill(pid, 0)` throws ESRCH for a dead pid. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

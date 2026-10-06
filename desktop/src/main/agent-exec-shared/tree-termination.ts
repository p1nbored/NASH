import type { ChildProcessHandle } from '../../shared/child-process/run-process'
import {
  forceTerminateProcessTree,
  signalProcessTree
} from '../../shared/child-process/process-tree-termination'
import {
  captureWindowsDescendantSnapshot,
  verifyWindowsDescendantSnapshotExit,
  type WindowsDescendantSnapshot
} from '../windows-descendant-exit-verification'
// Stops one child's process tree and reports only what was proven: POSIX by forced group kill plus quiescence, win32 by descendant snapshot.

/** Orca's verdict vocabulary for a process tree, with no synonyms. */
export type TreeVerdict = 'exited' | 'live' | 'unverifiable'

/** How the tree verdict was reached; only the first three are positive evidence about descendants. */
export type TreeMethod =
  | 'posix_group_quiescence'
  | 'posix_group_probe'
  | 'windows_descendant_snapshot'
  | 'root_exit_only'
  | 'version_probe_unproven'
  | 'not_started'

export type TreeProof = {
  readonly verdict: TreeVerdict
  readonly method: TreeMethod
}

export type TreeTerminationDeps = {
  readonly platform: NodeJS.Platform
  readonly signalTree: (child: ChildProcessHandle) => Promise<boolean>
  readonly forceTree: (child: ChildProcessHandle) => Promise<boolean>
  readonly captureWindowsTree: (rootPid: number) => Promise<WindowsDescendantSnapshot | null>
  readonly verifyWindowsTree: (
    snapshot: WindowsDescendantSnapshot,
    verifyMs: number
  ) => Promise<TreeVerdict>
  readonly groupExists: (pid: number) => boolean
}

export type TreeTerminationOptions = {
  /** How long the root gets to exit after the first signal before the kill is forced. */
  readonly graceMs: number
  /** How long to wait for the root's exit after a forced kill, and to poll the win32 snapshot. */
  readonly verifyMs: number
  /** Longest wait for the win32 descendant snapshot, taken before anything is killed. */
  readonly captureMs?: number
  readonly deps?: Partial<TreeTerminationDeps>
}

export type TreeTerminationOutcome = {
  readonly verdict: TreeVerdict
  readonly method: TreeMethod
  readonly rootExited: boolean
  readonly escalatedToForce: boolean
}

const DEFAULT_CAPTURE_MS = 2_000

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

const DEFAULT_DEPS: TreeTerminationDeps = {
  platform: process.platform,
  signalTree: (child) => signalProcessTree(child),
  forceTree: (child) => forceTerminateProcessTree(child),
  captureWindowsTree: (rootPid) => captureWindowsDescendantSnapshot(rootPid),
  verifyWindowsTree: (snapshot, verifyMs) =>
    verifyWindowsDescendantSnapshotExit(snapshot, { verifyMs }),
  groupExists: processGroupExists
}

function hasExited(child: ChildProcessHandle): boolean {
  return (child.exitCode ?? null) !== null || (child.signalCode ?? null) !== null
}

/** Resolves true as soon as the root's exit is observed, false when the wait runs out. */
function waitForRootExit(child: ChildProcessHandle, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(hasExited(child))
    }, timeoutMs)
    timer.unref?.()
    child.once('exit', onExit)
  })
}

/** A primitive that throws proves nothing, so it counts as a failed attempt. */
async function attempt<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch {
    return fallback
  }
}

async function captureBeforeKill(
  child: ChildProcessHandle,
  options: TreeTerminationOptions,
  deps: TreeTerminationDeps
): Promise<WindowsDescendantSnapshot | null> {
  const rootPid = child.pid
  if (rootPid === undefined) {
    return null
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), options.captureMs ?? DEFAULT_CAPTURE_MS)
    timer.unref?.()
  })
  try {
    return await Promise.race([attempt(() => deps.captureWindowsTree(rootPid), null), expired])
  } finally {
    clearTimeout(timer)
  }
}

function outcomeOf(
  proof: { verified: boolean; method: TreeMethod },
  rootExited: boolean,
  escalatedToForce: boolean
): TreeTerminationOutcome {
  const verdict: TreeVerdict = !rootExited ? 'live' : proof.verified ? 'exited' : 'unverifiable'
  return { verdict, method: proof.method, rootExited, escalatedToForce }
}

async function terminatePosix(
  child: ChildProcessHandle,
  options: TreeTerminationOptions,
  deps: TreeTerminationDeps
): Promise<TreeTerminationOutcome> {
  let rootExited = hasExited(child)
  if (!rootExited) {
    await attempt(() => deps.signalTree(child), false)
    rootExited = await waitForRootExit(child, options.graceMs)
  }
  // Delivery of the first signal proves nothing about helpers, so the group kill always follows.
  const quiescent = await attempt(() => deps.forceTree(child), false)
  rootExited = rootExited || (await waitForRootExit(child, options.verifyMs))
  return outcomeOf({ verified: quiescent, method: 'posix_group_quiescence' }, rootExited, true)
}

async function terminateWindows(
  child: ChildProcessHandle,
  options: TreeTerminationOptions,
  deps: TreeTerminationDeps
): Promise<TreeTerminationOutcome> {
  if (hasExited(child)) {
    // A dead root cannot be re-identified, so neither a snapshot nor a tree kill is safe.
    return {
      verdict: 'unverifiable',
      method: 'root_exit_only',
      rootExited: true,
      escalatedToForce: false
    }
  }
  const snapshot = await captureBeforeKill(child, options, deps)
  await attempt(() => deps.signalTree(child), false)
  let rootExited = await waitForRootExit(child, options.graceMs)
  const escalated = !rootExited
  if (escalated) {
    await attempt(() => deps.forceTree(child), false)
    rootExited = await waitForRootExit(child, options.verifyMs)
  }
  if (snapshot === null || !rootExited) {
    return outcomeOf({ verified: false, method: 'root_exit_only' }, rootExited, escalated)
  }
  const seen = await attempt(
    () => deps.verifyWindowsTree(snapshot, options.verifyMs),
    'unverifiable' as const
  )
  return {
    verdict: seen,
    method: 'windows_descendant_snapshot',
    rootExited,
    escalatedToForce: escalated
  }
}

export function terminateChildTree(
  child: ChildProcessHandle,
  options: TreeTerminationOptions
): Promise<TreeTerminationOutcome> {
  const deps = { ...DEFAULT_DEPS, ...options.deps }
  return deps.platform === 'win32'
    ? terminateWindows(child, options, deps)
    : terminatePosix(child, options, deps)
}

export type TreeInspection = {
  /** True only when a helper is known to be running after the root left. */
  readonly helperAlive: boolean
  readonly proof: TreeProof
}

/** What a root that exited and closed its pipes proves: only POSIX can see a surviving group. */
export function inspectTreeAfterRootExit(
  child: ChildProcessHandle,
  overrides: Partial<Pick<TreeTerminationDeps, 'platform' | 'groupExists'>> = {}
): TreeInspection {
  const deps = { ...DEFAULT_DEPS, ...overrides }
  const pid = child.pid
  if (deps.platform === 'win32' || pid === undefined) {
    return { helperAlive: false, proof: { verdict: 'unverifiable', method: 'root_exit_only' } }
  }
  const alive = deps.groupExists(pid)
  return {
    helperAlive: alive,
    proof: { verdict: alive ? 'live' : 'exited', method: 'posix_group_probe' }
  }
}

/** The daemon's chosen terminal process ceiling, applied to every PTY spawn it makes. */
import { existsSync } from 'node:fs'
import { runProcessSync } from '@orca/process-host'
import { userManagerEnv } from './daemon-cgroup-scope'
import { setPtyActiveProcessLimit } from '../windows/windows-pty-job'
import { resolvePtyProcessCeiling, type LinuxCeilingRuntime } from './pty-process-ceiling'
import type { PtyProcessCeilingState } from '../../shared/pty-process-ceiling-state'

let currentState: PtyProcessCeilingState = { state: 'off', reason: 'disabled' }
let currentLinux: LinuxCeilingRuntime | null = null
let scopeCounter = 0

/** Daemon start: decide, remember for every spawn, and return what the pid record reports. */
export function initializePtyProcessCeiling(launchId: string): PtyProcessCeilingState {
  const resolved = resolvePtyProcessCeiling({
    env: process.env,
    platform: process.platform,
    launchId: launchId || `${process.pid}`,
    setWindowsLimit: setPtyActiveProcessLimit
  })
  setPtyProcessCeilingForTest(resolved.state, resolved.linux)
  if (resolved.linux) {
    // Why on exit: every daemon exit path ends here, and its terminals are gone by then.
    process.once('exit', releasePtyProcessCeiling)
  }
  return resolved.state
}

export function setPtyProcessCeilingForTest(
  state: PtyProcessCeilingState,
  linux: LinuxCeilingRuntime | null
): void {
  currentState = state
  currentLinux = linux
}

export function currentPtyProcessCeiling(): PtyProcessCeilingState {
  return currentState
}

const SESSION_KEYS = ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'] as const

/**
 * Linux with the ceiling on: exec through `systemd-run --scope`, which keeps the pid and exit
 * status, into a scope under the ceiling slice. `systemd-run` talks to the user manager the daemon
 * verified; `env` then gives the shell its own session variables back. Off, it is the identity.
 */
export function wrapPtySpawnForCeiling(
  file: string,
  args: string[],
  env: Record<string, string>,
  pidsMaxExists: (path: string) => boolean = existsSync
): { file: string; args: string[]; env: Record<string, string> } {
  const runtime = currentLinux
  if (!runtime) {
    return { file, args, env }
  }
  // Why: a restarted user manager drops the transient slice, and `systemd-run --slice` would
  // silently create a plain one with no limit.
  if (!pidsMaxExists(runtime.pidsMaxPath)) {
    setPtyProcessCeilingForTest({ state: 'off', reason: 'slice_lost' }, null)
    return { file, args, env }
  }
  scopeCounter += 1
  const managerEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(userManagerEnv(env))) {
    if (typeof value === 'string' && key !== 'DBUS_SESSION_BUS_ADDRESS') {
      managerEnv[key] = value
    }
  }
  const unsets: string[] = []
  const sets: string[] = []
  for (const key of SESSION_KEYS) {
    if (env[key] !== managerEnv[key]) {
      if (env[key] === undefined) {
        unsets.push('-u', key)
      } else {
        sets.push(`${key}=${env[key]}`)
      }
    }
  }
  const restore = runtime.envBinary && unsets.length + sets.length > 0
  return {
    file: runtime.systemdRun,
    args: [
      '--user',
      '--scope',
      '--quiet',
      '--collect',
      `--slice=${runtime.slice}`,
      `--unit=orca_pty_${runtime.launchId}_${scopeCounter}.scope`,
      '--',
      ...(restore && runtime.envBinary ? [runtime.envBinary, ...unsets, ...sets] : []),
      file,
      ...args
    ],
    env: managerEnv
  }
}

/** Daemon exit: its terminals are gone, so the slice goes too. A SIGKILL is the death watch's job. */
export function releasePtyProcessCeiling(): void {
  const runtime = currentLinux
  currentLinux = null
  if (!runtime) {
    return
  }
  try {
    runProcessSync({
      program: 'systemctl',
      args: ['--user', '--no-block', 'stop', runtime.slice],
      env: userManagerEnv(process.env),
      stdio: 'ignore',
      timeoutMs: 2_000
    })
  } catch {
    // The slice is transient and holds nothing once every terminal has exited.
  }
}

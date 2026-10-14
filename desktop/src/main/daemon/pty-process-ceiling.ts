/**
 * An OS-enforced ceiling on how many processes the terminals of one daemon may run. Off by
 * default: it turns on only when `ORCA_TERMINAL_PROCESS_CEILING` names a limit, until saturation
 * tests show the daemon keeps serving with it on.
 *
 * Linux puts each PTY in its own transient scope under one slice that carries `TasksMax`, so the
 * kernel refuses forks past the limit with EAGAIN. The slice is a sibling of the daemon's own
 * scope: `pids.max` counts threads too, and the daemon must keep serving sockets, attach and
 * cancel while a build inside a terminal hits the ceiling.
 */
import { accessSync, constants, readFileSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { runProcessSync } from '@orca/process-host'
import { isDurableDaemonScopeSupported, userManagerEnv } from './daemon-cgroup-scope'
import type { PtyProcessCeilingState } from '../../shared/pty-process-ceiling-state'

export type { PtyProcessCeilingState } from '../../shared/pty-process-ceiling-state'

export const PTY_PROCESS_CEILING_ENV = 'ORCA_TERMINAL_PROCESS_CEILING'
/** Below this a shell, its prompt hooks and one build step already collide. */
const MIN_CEILING = 64
const CGROUP_ROOT = '/sys/fs/cgroup'

type Runner = (
  program: string,
  args: string[],
  env: NodeJS.ProcessEnv
) => { code: number | null; timedOut: boolean; stdout: string }

const defaultRunner: Runner = (program, args, env) =>
  runProcessSync({ program, args, env, timeoutMs: 5_000 })

/** What the Linux wrap needs at spawn time; never reported, only used. */
export type LinuxCeilingRuntime = {
  slice: string
  pidsMaxPath: string
  systemdRun: string
  envBinary: string | null
  launchId: string
}

export function parsePtyProcessCeiling(
  raw: string | undefined
): { kind: 'off' } | { kind: 'limit'; limit: number } | { kind: 'invalid' } {
  if (raw === undefined || raw.trim() === '' || raw.trim() === '0') {
    return { kind: 'off' }
  }
  const limit = Number(raw.trim())
  return Number.isSafeInteger(limit) && limit >= MIN_CEILING
    ? { kind: 'limit', limit }
    : { kind: 'invalid' }
}

const sanitizeId = (id: string): string => id.replace(/[^A-Za-z0-9]/g, '_')

/** No dashes: systemd reads `a-b.slice` as a child of `a.slice`, and this one must be top-level. */
export function ptyCeilingSliceName(launchId: string): string {
  return `orca_ptys_${sanitizeId(launchId)}.slice`
}

export function findExecutableOnPath(name: string, path: string | undefined): string | null {
  for (const dir of (path ?? '').split(delimiter).filter(isAbsolute)) {
    try {
      accessSync(join(dir, name), constants.X_OK)
      return join(dir, name)
    } catch {
      // Not here.
    }
  }
  return null
}

type ResolveInput = {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  launchId: string
  scopeSupported?: () => boolean
  run?: Runner
  findExecutable?: (name: string) => string | null
  readPidsMax?: (path: string) => string | null
  setWindowsLimit?: (limit: number) => boolean
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Decides once, at daemon start, whether this host gets a ceiling. Every failure is a named
 * "off", never a guess: "on" requires the kernel's own pids.max to show the limit.
 */
export function resolvePtyProcessCeiling(input: ResolveInput): {
  state: PtyProcessCeilingState
  linux: LinuxCeilingRuntime | null
} {
  const off = (reason: Extract<PtyProcessCeilingState, { state: 'off' }>['reason']) => ({
    state: { state: 'off' as const, reason },
    linux: null
  })
  const parsed = parsePtyProcessCeiling(input.env[PTY_PROCESS_CEILING_ENV])
  if (parsed.kind === 'off') {
    return off('disabled')
  }
  if (parsed.kind === 'invalid') {
    return off('invalid_limit')
  }
  if (input.platform === 'win32') {
    return input.setWindowsLimit?.(parsed.limit)
      ? {
          state: { state: 'on', limit: parsed.limit, mechanism: 'windows-job', unit: null },
          linux: null
        }
      : off('native_unavailable')
  }
  if (input.platform !== 'linux') {
    return off('unsupported_platform')
  }
  if (!(input.scopeSupported ?? isDurableDaemonScopeSupported)()) {
    return off('no_user_manager')
  }
  const find =
    input.findExecutable ?? ((name: string) => findExecutableOnPath(name, input.env.PATH))
  const systemdRun = find('systemd-run')
  if (!systemdRun) {
    return off('systemd_run_missing')
  }
  const run = input.run ?? defaultRunner
  const managerEnv = userManagerEnv(input.env)
  const slice = ptyCeilingSliceName(input.launchId)
  try {
    const created = run(
      'busctl',
      [
        '--user',
        'call',
        'org.freedesktop.systemd1',
        '/org/freedesktop/systemd1',
        'org.freedesktop.systemd1.Manager',
        'StartTransientUnit',
        'ssa(sv)a(sa(sv))',
        slice,
        'fail',
        '1',
        'TasksMax',
        't',
        String(parsed.limit),
        '0'
      ],
      managerEnv
    )
    if (created.code !== 0 || created.timedOut) {
      return off('slice_unavailable')
    }
    // Why verify: cgroup v1/hybrid hosts and managers without pids delegation accept TasksMax
    // and enforce nothing.
    const shown = run(
      'systemctl',
      ['--user', 'show', slice, '--property=ControlGroup', '--value'],
      managerEnv
    )
    const controlGroup = shown.code === 0 ? shown.stdout.trim() : ''
    const pidsMaxPath = controlGroup ? join(CGROUP_ROOT, controlGroup, 'pids.max') : ''
    const pidsMax = pidsMaxPath ? (input.readPidsMax ?? readFileOrNull)(pidsMaxPath) : null
    if (pidsMax?.trim() !== String(parsed.limit)) {
      run('systemctl', ['--user', '--no-block', 'stop', slice], managerEnv)
      return off('controller_unavailable')
    }
    return {
      state: {
        state: 'on',
        limit: parsed.limit,
        mechanism: 'systemd-slice',
        unit: slice,
        controlGroup
      },
      linux: {
        slice,
        pidsMaxPath,
        systemdRun,
        envBinary: find('env'),
        launchId: sanitizeId(input.launchId)
      }
    }
  } catch {
    return off('slice_unavailable')
  }
}

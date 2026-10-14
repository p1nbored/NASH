import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parsePtyProcessCeiling,
  PTY_PROCESS_CEILING_ENV,
  resolvePtyProcessCeiling,
  type LinuxCeilingRuntime
} from './pty-process-ceiling'
import {
  currentPtyProcessCeiling,
  setPtyProcessCeilingForTest,
  wrapPtySpawnForCeiling
} from './pty-process-ceiling-runtime'
import {
  confirmPtyProcessCeiling,
  describePtyProcessCeiling,
  parsePtyProcessCeilingState
} from '../../shared/pty-process-ceiling-state'
import { parseDaemonPidFile } from './daemon-pid-file-parse'

const on = { [PTY_PROCESS_CEILING_ENV]: '2048' }

function linuxInput(overrides: Partial<Parameters<typeof resolvePtyProcessCeiling>[0]> = {}) {
  const run = vi.fn((program: string, _args: string[]) => ({
    code: 0,
    timedOut: false,
    stdout:
      program === 'systemctl'
        ? '/user.slice/user-1000.slice/user@1000.service/orca_ptys_1f_2e.slice\n'
        : ''
  }))
  return {
    run,
    input: {
      env: on,
      platform: 'linux' as const,
      launchId: '1f-2e',
      scopeSupported: () => true,
      findExecutable: (name: string) => `/usr/bin/${name}`,
      readPidsMax: () => '2048\n',
      run,
      ...overrides
    }
  }
}

describe('resolvePtyProcessCeiling', () => {
  it('is off by default and refuses limits too small to run a shell', () => {
    expect(resolvePtyProcessCeiling({ env: {}, platform: 'linux', launchId: 'a' }).state).toEqual({
      state: 'off',
      reason: 'disabled'
    })
    expect(parsePtyProcessCeiling('0')).toEqual({ kind: 'off' })
    expect(
      resolvePtyProcessCeiling({
        env: { [PTY_PROCESS_CEILING_ENV]: '10' },
        platform: 'linux',
        launchId: 'a'
      }).state
    ).toEqual({ state: 'off', reason: 'invalid_limit' })
  })

  it('degrades with a reason without a user manager, systemd-run, or on macOS', () => {
    const { run, input } = linuxInput({ scopeSupported: () => false })
    expect(resolvePtyProcessCeiling(input).state).toEqual({
      state: 'off',
      reason: 'no_user_manager'
    })
    expect(run).not.toHaveBeenCalled()
    expect(
      resolvePtyProcessCeiling(linuxInput({ findExecutable: () => null }).input).state
    ).toEqual({ state: 'off', reason: 'systemd_run_missing' })
    expect(resolvePtyProcessCeiling({ env: on, platform: 'darwin', launchId: 'a' }).state).toEqual({
      state: 'off',
      reason: 'unsupported_platform'
    })
  })

  it('is on only when the kernel shows the limit on a top-level slice', () => {
    const { run, input } = linuxInput()
    const resolved = resolvePtyProcessCeiling(input)
    expect(resolved.state).toEqual({
      state: 'on',
      limit: 2048,
      mechanism: 'systemd-slice',
      unit: 'orca_ptys_1f_2e.slice',
      controlGroup: '/user.slice/user-1000.slice/user@1000.service/orca_ptys_1f_2e.slice'
    })
    expect(resolved.linux?.pidsMaxPath).toBe(
      '/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/orca_ptys_1f_2e.slice/pids.max'
    )
    expect(run.mock.calls[0]?.[0]).toBe('busctl')
    expect(run.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(['StartTransientUnit', 'orca_ptys_1f_2e.slice', 'TasksMax', '2048'])
    )
  })

  it('reports off when TasksMax is accepted but not enforced, and removes the slice', () => {
    const { run, input } = linuxInput({ readPidsMax: () => null })
    expect(resolvePtyProcessCeiling(input).state).toEqual({
      state: 'off',
      reason: 'controller_unavailable'
    })
    expect(run.mock.calls.at(-1)?.[1]).toEqual([
      '--user',
      '--no-block',
      'stop',
      'orca_ptys_1f_2e.slice'
    ])
    const failed = linuxInput({
      run: vi.fn(() => ({ code: 1, timedOut: false, stdout: '' }))
    })
    expect(resolvePtyProcessCeiling(failed.input).state).toEqual({
      state: 'off',
      reason: 'slice_unavailable'
    })
  })

  it('uses the per-terminal job limit on Windows only when the native build has it', () => {
    const windows = (setWindowsLimit: () => boolean) =>
      resolvePtyProcessCeiling({ env: on, platform: 'win32', launchId: 'a', setWindowsLimit }).state
    expect(windows(() => true)).toEqual({
      state: 'on',
      limit: 2048,
      mechanism: 'windows-job',
      unit: null
    })
    expect(windows(() => false)).toEqual({ state: 'off', reason: 'native_unavailable' })
  })
})

describe('wrapPtySpawnForCeiling', () => {
  const runtime: LinuxCeilingRuntime = {
    slice: 'orca_ptys_a.slice',
    pidsMaxPath: '/sys/fs/cgroup/x/pids.max',
    systemdRun: '/usr/bin/systemd-run',
    envBinary: '/usr/bin/env',
    launchId: 'a'
  }

  afterEach(() => setPtyProcessCeilingForTest({ state: 'off', reason: 'disabled' }, null))

  it('leaves the spawn untouched while off', () => {
    const env = { TERM: 'xterm' }
    expect(wrapPtySpawnForCeiling('/bin/bash', ['-l'], env)).toEqual({
      file: '/bin/bash',
      args: ['-l'],
      env
    })
  })

  it('execs through systemd-run into the slice and gives the shell its own session bus back', () => {
    setPtyProcessCeilingForTest(
      { state: 'on', limit: 2048, mechanism: 'systemd-slice', unit: runtime.slice },
      runtime
    )
    const wrapped = wrapPtySpawnForCeiling(
      '/bin/bash',
      ['-l'],
      { TERM: 'xterm', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/dbus-x' },
      () => true
    )
    expect(wrapped.file).toBe('/usr/bin/systemd-run')
    expect(wrapped.args).toEqual(
      expect.arrayContaining([
        '--user',
        '--scope',
        '--slice=orca_ptys_a.slice',
        '--unit=orca_pty_a_1.scope'
      ])
    )
    const command = wrapped.args.slice(wrapped.args.indexOf('--') + 1)
    expect(command[0]).toBe('/usr/bin/env')
    expect(command).toContain('DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/dbus-x')
    expect(command.slice(-2)).toEqual(['/bin/bash', '-l'])
    expect(wrapped.env.DBUS_SESSION_BUS_ADDRESS).toBeUndefined()
  })

  it('stops wrapping and reports the slice lost when the user manager dropped it', () => {
    setPtyProcessCeilingForTest(
      { state: 'on', limit: 2048, mechanism: 'systemd-slice', unit: runtime.slice },
      runtime
    )
    expect(wrapPtySpawnForCeiling('/bin/bash', [], { TERM: 'x' }, () => false).file).toBe(
      '/bin/bash'
    )
    expect(currentPtyProcessCeiling()).toEqual({ state: 'off', reason: 'slice_lost' })
  })
})

describe('ceiling report', () => {
  it('reports a slice the user manager dropped as lost, not on', () => {
    const on = {
      state: 'on' as const,
      limit: 2048,
      mechanism: 'systemd-slice' as const,
      unit: 'orca_ptys_a.slice',
      controlGroup: '/u/orca_ptys_a.slice'
    }
    expect(confirmPtyProcessCeiling(on, () => true)).toBe(on)
    expect(confirmPtyProcessCeiling(on, () => false)).toEqual({
      state: 'off',
      reason: 'slice_lost'
    })
    expect(confirmPtyProcessCeiling(null)).toBeNull()
  })

  it('round-trips through the daemon pid record and reads old records as not reported', () => {
    const record = parseDaemonPidFile(
      JSON.stringify({ pid: 7, processCeiling: { state: 'off', reason: 'no_user_manager' } })
    )
    expect(record?.processCeiling).toEqual({ state: 'off', reason: 'no_user_manager' })
    expect(parseDaemonPidFile(JSON.stringify({ pid: 7 }))?.processCeiling).toBeNull()
    expect(parsePtyProcessCeilingState({ state: 'off', reason: 'made-up' })).toBeNull()
    expect(describePtyProcessCeiling(null)).toBe('not reported')
    expect(describePtyProcessCeiling({ state: 'off', reason: 'no_user_manager' })).toBe(
      'off (no user manager)'
    )
  })
})

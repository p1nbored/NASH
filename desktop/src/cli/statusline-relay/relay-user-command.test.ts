import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '../../shared/child-process/run-process'
import {
  USER_STATUS_LINE_TIMEOUT_MS,
  runUserStatusLine,
  type UserCommandPorts
} from './relay-user-command'

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const INPUT = '{"model":{"display_name":"Opus"},"rate_limits":{}}'
// Why bytes: a status line carries colour escapes and non-ASCII glyphs that must pass through untouched.
const OUTPUT = Buffer.from('\u001b[32m[Opus]\u001b[0m \u2588\u2588 42%\n', 'utf8')

function ok(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    code: 0,
    signal: null,
    stdout: '',
    stdoutBytes: OUTPUT,
    stderr: '',
    timedOut: false,
    ...overrides
  }
}

function ports(run: UserCommandPorts['run'], env: NodeJS.ProcessEnv = {}): UserCommandPorts {
  return {
    env: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', ...env },
    cwd: 'C:\\work\\project',
    run
  }
}

describe('runUserStatusLine', () => {
  it('runs the command with the same stdin through the given bash and returns its bytes unchanged', async () => {
    const run = vi.fn(async (_spec: ProcessSpec) => ok())
    const output = await runUserStatusLine(
      { shell: GIT_BASH, command: 'node "C:/tools/hud.js"' },
      INPUT,
      ports(run)
    )
    expect(output).toBe(OUTPUT)
    expect(run).toHaveBeenCalledTimes(1)
    const [spec] = run.mock.calls[0]
    expect(spec.program).toBe(GIT_BASH)
    expect(spec.args).toEqual(['-c', 'node "C:/tools/hud.js"'])
    expect(spec.input).toBe(INPUT)
    expect(spec.cwd).toBe('C:\\work\\project')
    expect(spec.timeoutMs).toBe(USER_STATUS_LINE_TIMEOUT_MS)
    expect(spec.captureStdoutAsBytes).toBe(true)
    expect(spec.windowsVerbatimArguments).toBeUndefined()
  })

  it('never spawns cmd.exe or PowerShell and never asks for a shell', async () => {
    const run = vi.fn(async (_spec: ProcessSpec) => ok())
    await runUserStatusLine({ shell: GIT_BASH, command: 'echo hi' }, INPUT, ports(run))
    const [spec] = run.mock.calls[0]
    expect(spec.program).not.toMatch(/cmd(\.exe)?$|powershell|pwsh/i)
    expect(JSON.stringify(spec)).not.toMatch(/"shell":true/)
  })

  it.each([
    ['cmd.exe', 'C:\\Windows\\System32\\cmd.exe'],
    ['Windows PowerShell', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    ['PowerShell 7', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'],
    ['a batch file', 'C:\\tools\\bash.cmd'],
    ['a relative bash', 'bash.exe']
  ])('refuses to spawn %s as the shell', async (_label, shell) => {
    const run = vi.fn(async (_spec: ProcessSpec) => ok())
    await expect(runUserStatusLine({ shell, command: 'echo hi' }, INPUT, ports(run))).resolves.toBe(
      null
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('drops ELECTRON_RUN_AS_NODE from the environment in any letter case, keeping the rest', async () => {
    const run = vi.fn(async (_spec: ProcessSpec) => ok())
    await runUserStatusLine(
      { shell: GIT_BASH, command: 'echo hi' },
      INPUT,
      ports(run, { electron_run_as_node: '1' })
    )
    const env = run.mock.calls[0][0].env ?? {}
    expect(Object.keys(env).map((key) => key.toUpperCase())).not.toContain('ELECTRON_RUN_AS_NODE')
    expect(env).toMatchObject({ PATH: '/usr/bin', CLAUDECODE: '1' })
  })

  it('runs nothing when the user has no status line', async () => {
    const run = vi.fn(async (_spec: ProcessSpec) => ok())
    await expect(
      runUserStatusLine({ shell: GIT_BASH, command: null }, INPUT, ports(run))
    ).resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-zero exit', ok({ code: 1 })],
    ['a timeout', ok({ code: null, timedOut: true })],
    ['a kill by signal', ok({ code: null, signal: 'SIGTERM' })],
    ['output past the cap', ok({ outputTruncated: true })],
    ['no captured bytes', ok({ stdoutBytes: undefined })]
  ])('prints nothing after %s', async (_label, result) => {
    const run = vi.fn(async (_spec: ProcessSpec) => result)
    await expect(
      runUserStatusLine({ shell: GIT_BASH, command: 'hud' }, INPUT, ports(run))
    ).resolves.toBeNull()
  })

  it('prints nothing when the shell cannot be started', async () => {
    const run = vi.fn(async (_spec: ProcessSpec): Promise<ProcessResult> => {
      throw new Error('spawn ENOENT')
    })
    await expect(
      runUserStatusLine({ shell: GIT_BASH, command: 'hud' }, INPUT, ports(run))
    ).resolves.toBeNull()
  })
})

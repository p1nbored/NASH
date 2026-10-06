import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock, terminateMock, inspectMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  terminateMock: vi.fn(),
  inspectMock: vi.fn()
}))

// FIXTURE_ONLY: the process pipeline and the tree killer are both faked, so no process starts
// and nothing can be killed by pid.
vi.mock('../../shared/child-process/run-process', () => ({ spawnProcess: spawnMock }))
vi.mock('./tree-termination', () => ({
  terminateChildTree: terminateMock,
  inspectTreeAfterRootExit: inspectMock
}))

import {
  runManagedChild,
  type ManagedChildOutcome,
  type ManagedChildSpec
} from './managed-child-session'

type FakeChild = EventEmitter & {
  pid: number | undefined
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
}

function fakeChild(pid: number | null = 4242): FakeChild {
  return Object.assign(new EventEmitter(), {
    pid: pid ?? undefined,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough()
  })
}

type Summary = { readonly seen: string; readonly closed: boolean }

/** A tool's pipe handling reduced to its essentials: it collects stdout and notes the close. */
function spec(
  overrides: Partial<ManagedChildSpec<{ close: () => void }, Summary>> = {}
): ManagedChildSpec<{ close: () => void }, Summary> {
  let seen = ''
  let closed = false
  return {
    executable: {
      program: 'tool-fixture',
      prefixArgs: ['entry.js'],
      entryPath: 'entry.js',
      requestedPath: 'entry.js',
      launch: 'node-entry'
    },
    argv: ['--one', '--two'],
    stdinText: 'stdin text',
    cwd: '/work',
    env: { PATH: '/bin' },
    timeoutMs: 60_000,
    graceMs: 10,
    verifyMs: 10,
    drainGraceMs: 40,
    platform: 'linux',
    attachIo: (child) => {
      child.stdout.on('data', (chunk: Buffer) => {
        seen += chunk.toString('utf8')
      })
      return {
        close: () => {
          closed = true
        }
      }
    },
    summarize: () => ({ seen, closed }),
    ...overrides
  }
}

const EXITED = {
  verdict: 'exited',
  method: 'posix_group_quiescence',
  rootExited: true,
  escalatedToForce: true
} as const

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function ran(outcome: ManagedChildOutcome<Summary>) {
  if (outcome.kind !== 'ran') {
    throw new Error('expected the child to have run')
  }
  return outcome
}

function finish(child: FakeChild, code = 0): void {
  child.emit('exit', code, null)
  child.emit('close', code, null)
}

beforeEach(() => {
  inspectMock.mockReturnValue({
    helperAlive: false,
    proof: { verdict: 'exited', method: 'posix_group_probe' }
  })
  terminateMock.mockResolvedValue(EXITED)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('runManagedChild launch', () => {
  it('hands the pipeline the prefix args then the argv, with the cwd, env and a group leader on POSIX', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runManagedChild(spec())
    finish(child)
    await pending
    expect(spawnMock).toHaveBeenCalledWith({
      program: 'tool-fixture',
      args: ['entry.js', '--one', '--two'],
      cwd: '/work',
      env: { PATH: '/bin' },
      detached: true
    })
  })

  it('does not detach on Windows, where the tree is killed by snapshot and not by group', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runManagedChild(spec({ platform: 'win32' }))
    finish(child)
    await pending
    expect(spawnMock.mock.calls[0]?.[0]).toMatchObject({ detached: false })
  })

  it('writes the stdin text and closes stdin', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const chunks: Buffer[] = []
    child.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
    const ended = new Promise<void>((resolve) => child.stdin.on('end', resolve))
    const pending = runManagedChild(spec({ stdinText: 'héllo 你好' }))
    await ended
    finish(child)
    await pending
    expect(Buffer.concat(chunks).toString('utf8')).toBe('héllo 你好')
  })

  it('reports a synchronous spawn throw as never started, with the message redacted', async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error('Spawn refused sk-FIXTUREONLY1234567890abcdef')
    })
    const outcome = await runManagedChild(spec())
    expect(outcome.kind).toBe('not_started')
    if (outcome.kind === 'not_started') {
      expect(outcome.spawnError).toContain('Spawn refused')
      expect(outcome.spawnError).not.toContain('sk-FIXTUREONLY1234567890abcdef')
    }
  })

  it('reports an asynchronous spawn error (no pid) as never started and closes the pipes', async () => {
    const child = fakeChild(null)
    spawnMock.mockReturnValue(child)
    const pending = runManagedChild(spec())
    child.emit('error', new Error('spawn ENOENT'))
    expect(await pending).toEqual({ kind: 'not_started', spawnError: 'spawn ENOENT' })
  })
})

describe('runManagedChild settlement', () => {
  it('settles on close with the summary read after the pipes were closed', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runManagedChild(spec())
    child.stdout.write('answer')
    await flush()
    finish(child, 0)
    const outcome = ran(await pending)
    expect(outcome).toMatchObject({
      exitCode: 0,
      exitSignal: null,
      summary: { seen: 'answer', closed: true },
      stdoutDrainTimedOut: false,
      descendantOutlivedRoot: false,
      termination: null,
      treeProof: { verdict: 'exited', method: 'posix_group_probe' }
    })
  })

  it('does not settle on an error from a process that did start, but on its close', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runManagedChild(spec())
    child.emit('error', new Error('stream hiccup'))
    child.emit('exit', 0, null)
    child.emit('close', 0, null)
    expect(ran(await pending).exitCode).toBe(0)
  })

  it('sweeps and flags a helper that is still alive after the root closed', async () => {
    inspectMock.mockReturnValue({
      helperAlive: true,
      proof: { verdict: 'live', method: 'posix_group_probe' }
    })
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runManagedChild(spec())
    finish(child, 0)
    const outcome = ran(await pending)
    expect(outcome.descendantOutlivedRoot).toBe(true)
    expect(outcome.termination).toEqual({ trigger: 'post_exit_sweep', outcome: EXITED })
    expect(outcome.treeProof).toEqual({ verdict: 'exited', method: 'posix_group_quiescence' })
  })

  it('stops the tree on abort and reports the termination outcome as the tree proof', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const controller = new AbortController()
    const pending = runManagedChild(spec({ signal: controller.signal }))
    controller.abort()
    const outcome = ran(await pending)
    expect(terminateMock).toHaveBeenCalledTimes(1)
    expect(outcome.termination).toEqual({ trigger: 'abort_signal', outcome: EXITED })
    expect(outcome.treeProof).toEqual({ verdict: 'exited', method: 'posix_group_quiescence' })
  })

  it('stops a tool that asks to be stopped for breaking a limit, once, with its own trigger', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const holder: { stop: ((trigger: 'output_limit') => void) | null } = { stop: null }
    const pending = runManagedChild(
      spec({
        attachIo: (_child, stop) => {
          holder.stop = stop
          return { close: () => {} }
        }
      })
    )
    holder.stop?.('output_limit')
    holder.stop?.('output_limit')
    const outcome = ran(await pending)
    expect(terminateMock).toHaveBeenCalledTimes(1)
    expect(outcome.termination).toEqual({ trigger: 'output_limit', outcome: EXITED })
  })

  it('reports an unverified tree when termination throws, and still settles', async () => {
    terminateMock.mockRejectedValue(new Error('taskkill vanished'))
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const controller = new AbortController()
    const pending = runManagedChild(spec({ signal: controller.signal }))
    controller.abort()
    const outcome = ran(await pending)
    expect(outcome.treeProof).toEqual({ verdict: 'unverifiable', method: 'root_exit_only' })
    expect(outcome.termination?.outcome).toMatchObject({
      rootExited: false,
      escalatedToForce: false
    })
  })

  it('stops a run that exceeds its timeout', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runManagedChild(spec({ timeoutMs: 1000 }))
    await vi.advanceTimersByTimeAsync(1001)
    const outcome = ran(await pending)
    expect(outcome.termination?.trigger).toBe('timeout')
  })

  it('arms no timer without a timeout: the run ends when the CLI ends or is stopped (D-027)', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const settled = vi.fn()
    const pending = runManagedChild(spec({ timeoutMs: null })).then(settled)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(settled).not.toHaveBeenCalled()
    finish(child)
    await pending
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ran' }))
  })

  it('stops waiting for output a helper holds open after the root exited', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runManagedChild(spec({ drainGraceMs: 500 }))
    child.emit('exit', 0, null)
    await vi.advanceTimersByTimeAsync(501)
    const outcome = ran(await pending)
    expect(outcome.stdoutDrainTimedOut).toBe(true)
    expect(outcome.descendantOutlivedRoot).toBe(true)
    expect(outcome.termination?.trigger).toBe('drain_timeout')
  })

  it('removes its abort listener once settled', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = runManagedChild(spec({ signal: controller.signal }))
    finish(child)
    await pending
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
    controller.abort()
    expect(terminateMock).not.toHaveBeenCalled()
  })
})

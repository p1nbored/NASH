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
vi.mock('../agent-exec-shared/tree-termination', () => ({
  terminateChildTree: terminateMock,
  inspectTreeAfterRootExit: inspectMock
}))

import {
  runChildSession,
  type ChildSessionInput,
  type ChildSessionOutcome
} from './codex-exec-child-session'

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

const GOOD_ARGV = [
  'exec',
  '--json',
  '--model',
  'gpt-6-astra',
  '-c',
  'model_reasoning_effort="high"',
  '--sandbox',
  'read-only',
  '--cd',
  '/work',
  '--ignore-user-config',
  '--ignore-rules',
  '--output-last-message',
  '/runs/r1/last-message.txt',
  '-'
]

function input(overrides: Partial<ChildSessionInput> = {}): ChildSessionInput {
  return {
    executable: {
      program: 'node-fixture',
      prefixArgs: ['entry.js'],
      entryPath: 'entry.js',
      requestedPath: 'entry.js',
      launch: 'node-entry',
      source: 'node-entry',
      electronRunAsNode: false
    },
    argv: GOOD_ARGV,
    prompt: 'prompt',
    cwd: '/work',
    env: { PATH: '/bin' },
    timeoutMs: 60_000,
    graceMs: 10,
    verifyMs: 10,
    maxLineBytes: 4096,
    maxStderrBytes: 1024,
    drainGraceMs: 40,
    stream: {},
    platform: 'linux',
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

function ran(outcome: ChildSessionOutcome) {
  if (outcome.kind !== 'ran') {
    throw new Error('expected the child to have run')
  }
  return outcome
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

function finish(child: FakeChild, code = 0): void {
  child.emit('exit', code, null)
  child.emit('close', code, null)
}

describe('runChildSession launch', () => {
  it('hands the pipeline the prefix args, argv, cwd and env', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runChildSession(input())
    finish(child)
    await pending
    expect(spawnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'node-fixture',
        args: ['entry.js', ...GOOD_ARGV],
        cwd: '/work',
        env: { PATH: '/bin' }
      })
    )
  })

  it.each([
    ['linux', true],
    ['darwin', true],
    ['win32', false]
  ] as const)(
    'starts the child as a group leader only where the platform kills by group: %s',
    async (platform, detached) => {
      const child = fakeChild()
      spawnMock.mockReturnValue(child)
      const pending = runChildSession(input({ platform }))
      finish(child)
      await pending
      expect(spawnMock.mock.calls[0]?.[0]).toMatchObject({ detached })
    }
  )

  it('writes the prompt to stdin and closes it', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const chunks: Buffer[] = []
    child.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
    const ended = new Promise<void>((resolve) => child.stdin.on('end', resolve))
    const pending = runChildSession(input({ prompt: 'héllo 你好' }))
    await ended
    finish(child)
    await pending
    expect(Buffer.concat(chunks).toString('utf8')).toBe('héllo 你好')
  })

  it('reports a synchronous spawn throw as never started, with the error redacted', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('spawn EINVAL sk-FIXTUREONLY1234567890abcdef')
    })
    const outcome = await runChildSession(input())
    expect(outcome.kind).toBe('not_started')
    if (outcome.kind === 'not_started') {
      expect(outcome.spawnError).toContain('EINVAL')
      expect(outcome.spawnError).not.toContain('sk-FIXTUREONLY1234567890abcdef')
    }
  })

  it('reports an asynchronous spawn error (no pid) as never started', async () => {
    const child = fakeChild(null)
    spawnMock.mockReturnValue(child)
    const pending = runChildSession(input())
    child.emit('error', new Error('spawn ENOENT'))
    expect(await pending).toEqual({ kind: 'not_started', spawnError: 'spawn ENOENT' })
  })
})

describe('runChildSession settlement', () => {
  it('does not settle on an error from a process that did start, but on its close', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    let settled = false
    const pending = runChildSession(input()).then((outcome) => {
      settled = true
      return outcome
    })
    child.emit('error', new Error('kill EPERM'))
    await flush()
    expect(settled).toBe(false)
    finish(child, 3)
    expect(ran(await pending)).toMatchObject({ exitCode: 3, termination: null })
  })

  it('records a clean exit with the tree proof the probe gave, and no termination', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runChildSession(input())
    finish(child)
    const outcome = ran(await pending)
    expect(outcome).toMatchObject({
      exitCode: 0,
      stdoutDrainTimedOut: false,
      descendantOutlivedRoot: false,
      termination: null,
      treeProof: { verdict: 'exited', method: 'posix_group_probe' }
    })
    expect(terminateMock).not.toHaveBeenCalled()
  })

  it('sweeps a process group that is still alive after the root closed, and says a helper outlived it', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    inspectMock.mockReturnValue({
      helperAlive: true,
      proof: { verdict: 'live', method: 'posix_group_probe' }
    })
    const pending = runChildSession(input())
    finish(child)
    const outcome = ran(await pending)
    expect(terminateMock).toHaveBeenCalledOnce()
    expect(outcome).toMatchObject({
      descendantOutlivedRoot: true,
      stdoutDrainTimedOut: false,
      termination: { trigger: 'post_exit_sweep', outcome: EXITED },
      treeProof: { verdict: 'exited', method: 'posix_group_quiescence' }
    })
  })

  it('keeps a helper that holds the pipe open from stalling the run, and terminates it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runChildSession(input({ drainGraceMs: 30 }))
    child.stdout.write('{"type":"turn.started"}\n')
    child.emit('exit', 0, null)
    await vi.advanceTimersByTimeAsync(29)
    expect(terminateMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    const outcome = ran(await pending)
    expect(terminateMock).toHaveBeenCalledOnce()
    expect(outcome).toMatchObject({
      stdoutDrainTimedOut: true,
      descendantOutlivedRoot: true,
      exitCode: 0,
      termination: { trigger: 'drain_timeout' }
    })
    expect(outcome.stream.turnStartedCount).toBe(1)
    expect(child.stdout.destroyed).toBe(true)
  })

  it('does not report a drain timeout when close arrives in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runChildSession(input({ drainGraceMs: 200 }))
    child.emit('exit', 0, null)
    await vi.advanceTimersByTimeAsync(150)
    child.emit('close', 0, null)
    expect(ran(await pending).stdoutDrainTimedOut).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(terminateMock).not.toHaveBeenCalled()
  })

  it('destroys every pipe when it settles, so a surviving helper cannot keep handles alive', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runChildSession(input())
    finish(child)
    await pending
    expect([child.stdin.destroyed, child.stdout.destroyed, child.stderr.destroyed]).toEqual([
      true,
      true,
      true
    ])
  })
})

describe('runChildSession stream handling', () => {
  it('parses stdout incrementally and keeps a bounded stderr tail', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const seen: string[] = []
    const pending = runChildSession(
      input({ maxStderrBytes: 16, onEvent: (event) => void seen.push(event.kind) })
    )
    child.stdout.write('{"type":"thread.started","thread_id":"t"}\n{"type":"turn')
    child.stdout.write('.started"}\n')
    child.stderr.write('0123456789abcdefghijklmnop')
    await vi.waitFor(() => expect(seen).toEqual(['thread_started', 'turn_started']))
    finish(child)
    const outcome = ran(await pending)
    expect(outcome.stderrTail).toBe('abcdefghijklmnop')
    expect(outcome.stderrTruncated).toBe(true)
    expect(outcome.stdoutBytes).toBeGreaterThan(40)
  })

  it('counts a throwing listener instead of breaking the parse', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const listener = vi.fn(() => {
      throw new Error('listener failed')
    })
    const pending = runChildSession(input({ onEvent: listener }))
    child.stdout.write('{"type":"turn.started"}\n{"type":"turn.started"}\n')
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))
    finish(child)
    const outcome = ran(await pending)
    expect(outcome.listenerErrorCount).toBe(2)
    expect(outcome.stream.turnStartedCount).toBe(2)
  })

  it('counts a listener that rejects asynchronously, without an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', record)
    try {
      const child = fakeChild()
      spawnMock.mockReturnValue(child)
      const listener = vi.fn(() => Promise.reject(new Error('async listener failed')))
      const pending = runChildSession(input({ onEvent: listener }))
      child.stdout.write('{"type":"turn.started"}\n')
      await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
      await flush()
      finish(child)
      expect(ran(await pending).listenerErrorCount).toBe(1)
      await flush()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', record)
    }
  })

  it('survives a stdin write failure on a child that exits without reading', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runChildSession(input())
    child.stdin.emit('error', new Error('write EPIPE'))
    finish(child, 1)
    expect(ran(await pending)).toMatchObject({ exitCode: 1 })
  })
})

describe('runChildSession abort and timeout', () => {
  it('stops the tree on abort and reports what the termination proved', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const controller = new AbortController()
    const pending = runChildSession(input({ signal: controller.signal }))
    controller.abort()
    const outcome = ran(await pending)
    expect(terminateMock).toHaveBeenCalledWith(
      child,
      expect.objectContaining({ graceMs: 10, verifyMs: 10 })
    )
    expect(outcome.termination).toEqual({ trigger: 'abort_signal', outcome: EXITED })
    expect(outcome.treeProof).toEqual({ verdict: 'exited', method: 'posix_group_quiescence' })
  })

  it('stops the tree when the timeout elapses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    terminateMock.mockResolvedValue({ ...EXITED, verdict: 'live', rootExited: false })
    const pending = runChildSession(input({ timeoutMs: 20 }))
    await vi.advanceTimersByTimeAsync(21)
    const outcome = ran(await pending)
    expect(outcome.termination).toMatchObject({ trigger: 'timeout', outcome: { verdict: 'live' } })
    expect(outcome.exitCode).toBeNull()
  })

  it('treats an already aborted signal as one stop request, not two kills', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const controller = new AbortController()
    controller.abort()
    const outcome = ran(await runChildSession(input({ signal: controller.signal })))
    expect(terminateMock).toHaveBeenCalledOnce()
    expect(outcome.termination?.trigger).toBe('abort_signal')
  })

  it('does not stop a root that has not been asked to, once the timeout has been cleared by its exit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const pending = runChildSession(input({ timeoutMs: 50, drainGraceMs: 500 }))
    child.emit('exit', 0, null)
    await vi.advanceTimersByTimeAsync(60)
    expect(terminateMock).not.toHaveBeenCalled()
    child.emit('close', 0, null)
    expect(ran(await pending).termination).toBeNull()
  })

  it('does not drop an abort that arrives after the root exited but before the pipes closed', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    inspectMock.mockReturnValue({
      helperAlive: false,
      proof: { verdict: 'unverifiable', method: 'root_exit_only' }
    })
    terminateMock.mockResolvedValue({
      verdict: 'unverifiable',
      method: 'root_exit_only',
      rootExited: true,
      escalatedToForce: false
    })
    const controller = new AbortController()
    const pending = runChildSession(input({ signal: controller.signal, drainGraceMs: 5_000 }))
    child.emit('exit', 0, null)
    controller.abort()
    const outcome = ran(await pending)
    expect(terminateMock).toHaveBeenCalledOnce()
    expect(outcome.termination).toMatchObject({ trigger: 'abort_signal' })
    expect(outcome.exitCode).toBe(0)
  })

  it('ignores a second stop request while the first termination is in flight', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    let release: (value: typeof EXITED) => void = () => {}
    terminateMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    const controller = new AbortController()
    const pending = runChildSession(input({ signal: controller.signal, timeoutMs: 5 }))
    controller.abort()
    await flush()
    controller.signal.dispatchEvent(new Event('abort'))
    release(EXITED)
    const outcome = ran(await pending)
    expect(terminateMock).toHaveBeenCalledOnce()
    expect(outcome.termination?.trigger).toBe('abort_signal')
  })

  it('waits for the termination to finish even when close arrives first', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    let release: (value: typeof EXITED) => void = () => {}
    terminateMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    const controller = new AbortController()
    let settled = false
    const pending = runChildSession(input({ signal: controller.signal })).then((outcome) => {
      settled = true
      return outcome
    })
    controller.abort()
    finish(child, 1)
    await flush()
    expect(settled).toBe(false)
    release(EXITED)
    expect(ran(await pending).termination).toMatchObject({ trigger: 'abort_signal' })
  })

  it('removes its abort listener once it settles, and never adds a second', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    const added: unknown[] = []
    const removed: unknown[] = []
    const signal = {
      aborted: false,
      addEventListener: (_type: string, handler: unknown) => void added.push(handler),
      removeEventListener: (_type: string, handler: unknown) => void removed.push(handler)
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the session only reads `aborted` and add/removeEventListener on the signal, which this stub provides.
    const pending = runChildSession(input({ signal: signal as unknown as AbortSignal }))
    finish(child)
    await pending
    expect(added).toHaveLength(1)
    expect(removed).toEqual(added)
  })

  it('maps a termination that throws to an unverifiable outcome instead of hanging', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)
    terminateMock.mockRejectedValue(new Error('taskkill vanished'))
    const controller = new AbortController()
    const pending = runChildSession(input({ signal: controller.signal }))
    controller.abort()
    const outcome = ran(await pending)
    expect(outcome.termination).toMatchObject({
      trigger: 'abort_signal',
      outcome: { verdict: 'unverifiable', rootExited: false }
    })
    expect(outcome.treeProof.verdict).toBe('unverifiable')
  })
})

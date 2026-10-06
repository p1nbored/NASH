import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WindowsDescendantSnapshot } from '../windows-descendant-exit-verification'
import {
  createFakeAgyRun,
  isProcessAlive,
  successSteps,
  type FakeAgyRun,
  type FakeStep
} from './agy-exec-fake-agy.test-fixture'
import { runAgyExec } from './agy-exec-run'

// FIXTURE_ONLY: every run below drives the scripted fake; no real agy binary starts.
const runs: FakeAgyRun[] = []

function fake(steps: readonly FakeStep[]): FakeAgyRun {
  const run = createFakeAgyRun(steps)
  runs.push(run)
  return run
}

afterEach(() => {
  for (const run of runs.splice(0)) {
    run.cleanup()
  }
})

// The fake writes its grandchild pid and then the ready marker, so a test can wait for both.
const HANGING_RUN: readonly FakeStep[] = [
  { stdout: 'working...\n' },
  { grandchild: true, lifetimeMs: 60_000 },
  { ready: true },
  { hang: true }
]

const TIGHT = { graceMs: 1500, verifyMs: 3000 }

const SNAPSHOT: WindowsDescendantSnapshot = {
  root: { pid: 1, creationTimeMs: 1 },
  descendants: [],
  unidentifiedCount: 0,
  capturedAtMs: 1
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return condition()
}

/** The honest tree proof of a stopped run: POSIX proves the group, Windows only the root without a snapshot. */
const STOPPED_PROOF =
  process.platform === 'win32'
    ? { verdict: 'unverifiable', method: 'root_exit_only' }
    : { verdict: 'exited', method: 'posix_group_quiescence' }

describe('runAgyExec cancellation', () => {
  it('stops a run mid-flight through AbortSignal and kills the whole process tree', async () => {
    const run = fake(HANGING_RUN)
    const controller = new AbortController()
    const pending = runAgyExec(run.request(), run.options({ signal: controller.signal, ...TIGHT }))
    expect(await waitFor(() => run.ready())).toBe(true)
    controller.abort()
    const result = await pending

    expect(result.verdict).toMatchObject({ status: 'failed', failures: [{ kind: 'cancelled' }] })
    expect(result.cancellation).toMatchObject({
      requested: true,
      trigger: 'abort_signal',
      spawned: true,
      rootExited: true,
      ...STOPPED_PROOF
    })
    expect(result.treeProof).toEqual(STOPPED_PROOF)
    expect(result.output).toMatchObject({ state: 'not_read', path: null })
    expect(existsSync(join(run.runDir, 'output.txt'))).toBe(false)
    const pid = run.grandchildPid()
    expect(pid).not.toBeNull()
    expect(await waitFor(() => !isProcessAlive(pid ?? 0), 5000)).toBe(true)
  }, 30_000)

  it('reports an exited tree when the root exits and the descendants are proven gone', async () => {
    const run = fake(HANGING_RUN)
    const controller = new AbortController()
    const termination =
      process.platform === 'win32'
        ? {
            captureWindowsTree: async () => SNAPSHOT,
            verifyWindowsTree: async () => 'exited' as const
          }
        : {}
    const pending = runAgyExec(
      run.request(),
      run.options({ signal: controller.signal, ...TIGHT, deps: { termination } })
    )
    expect(await waitFor(() => run.ready())).toBe(true)
    controller.abort()
    const result = await pending
    expect(result.cancellation).toMatchObject({
      requested: true,
      verdict: 'exited',
      rootExited: true
    })
    expect(result.treeProof.verdict).toBe('exited')
    expect(await waitFor(() => !isProcessAlive(run.grandchildPid() ?? 0), 5000)).toBe(true)
  }, 30_000)

  it('reports an unverifiable tree when the root exits but nothing proves the descendants gone', async () => {
    const run = fake(HANGING_RUN)
    const controller = new AbortController()
    const pending = runAgyExec(
      run.request(),
      run.options({
        signal: controller.signal,
        ...TIGHT,
        deps: {
          termination: {
            captureWindowsTree: async () => null,
            // The root dies, but the group kill that would prove the rest reports nothing.
            signalTree: async (child) => child.kill('SIGKILL'),
            forceTree: async () => false
          }
        }
      })
    )
    expect(await waitFor(() => run.ready())).toBe(true)
    controller.abort()
    const result = await pending
    expect(result.cancellation).toMatchObject({
      requested: true,
      verdict: 'unverifiable',
      rootExited: true
    })
    expect(result.treeProof.verdict).toBe('unverifiable')
    const pid = run.grandchildPid()
    if (pid !== null && isProcessAlive(pid)) {
      process.kill(pid)
    }
  }, 30_000)

  it('reports a live tree when the root survives both signals, never exited', async () => {
    const run = fake(HANGING_RUN)
    const controller = new AbortController()
    const pending = runAgyExec(
      run.request(),
      run.options({
        signal: controller.signal,
        graceMs: 100,
        verifyMs: 300,
        deps: {
          termination: {
            captureWindowsTree: async () => null,
            signalTree: async () => false,
            forceTree: async () => false
          }
        }
      })
    )
    expect(await waitFor(() => run.ready())).toBe(true)
    const rootPid = run.received()?.pid ?? 0
    controller.abort()
    const result = await pending
    try {
      expect(result.verdict).toMatchObject({ status: 'failed', failures: [{ kind: 'cancelled' }] })
      expect(result.cancellation).toMatchObject({
        requested: true,
        verdict: 'live',
        rootExited: false,
        escalatedToForce: true
      })
      expect(result.treeProof.verdict).toBe('live')
    } finally {
      // The fake survived on purpose; stop it and its helper so no test leaves a process behind.
      for (const pid of [rootPid, run.grandchildPid() ?? 0]) {
        if (pid > 0 && isProcessAlive(pid)) {
          process.kill(pid)
        }
      }
    }
  }, 30_000)

  it('does not start a process when the signal is already aborted', async () => {
    const run = fake(HANGING_RUN)
    const controller = new AbortController()
    controller.abort()
    const result = await runAgyExec(run.request(), run.options({ signal: controller.signal }))
    expect(result.verdict).toMatchObject({ status: 'failed', failures: [{ kind: 'cancelled' }] })
    expect(result.spawned).toBe(false)
    expect(result.cancellation).toMatchObject({
      requested: true,
      trigger: 'abort_signal',
      spawned: false,
      verdict: 'exited',
      method: 'not_started'
    })
    expect(run.received()).toBeNull()
  })

  it('stops a run that exceeds its timeout and labels it timed_out', async (context) => {
    const run = fake(HANGING_RUN)
    const result = await runAgyExec(run.request(), run.options({ timeoutMs: 4000, ...TIGHT }))
    expect(result.verdict).toMatchObject({ status: 'failed', failures: [{ kind: 'timed_out' }] })
    expect(result.cancellation).toMatchObject({
      requested: true,
      trigger: 'timeout',
      rootExited: true,
      ...STOPPED_PROOF
    })
    if (!run.ready()) {
      // Node started later than the timeout on this host; the label above is still proven.
      context.skip()
    }
    expect(await waitFor(() => !isProcessAlive(run.grandchildPid() ?? 0), 5000)).toBe(true)
  }, 30_000)

  // Windows closes the pipes with the root even when a helper inherited them, so this needs POSIX to run.
  it.skipIf(process.platform === 'win32')(
    'terminates a helper that holds stdout open after the root exited, and never reports completed',
    async () => {
      const run = fake([
        { stdout: 'answer\n' },
        { grandchild: true, lifetimeMs: 60_000, inheritStdout: true },
        { exit: 0 }
      ])
      const result = await runAgyExec(
        run.request(),
        run.options({ limits: { drainGraceMs: 300 }, ...TIGHT })
      )
      expect(result.stdoutDrainTimedOut).toBe(true)
      expect(result.verdict).toMatchObject({
        status: 'failed',
        failures: [{ kind: 'descendant_outlived_root' }]
      })
      expect(result.treeProof).toEqual({ verdict: 'exited', method: 'posix_group_quiescence' })
      expect(await waitFor(() => !isProcessAlive(run.grandchildPid() ?? 0), 5000)).toBe(true)
    },
    30_000
  )

  it('ignores an abort that arrives after the run has finished', async () => {
    const run = fake(successSteps())
    const controller = new AbortController()
    const result = await runAgyExec(run.request(), run.options({ signal: controller.signal }))
    controller.abort()
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.cancellation).toEqual({ requested: false })
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import {
  createFakeCodexRun,
  fakeEvents,
  isProcessAlive,
  type FakeCodexRun,
  type FakeStep
} from './codex-exec-fake-codex.test-fixture'
import { runCodexExec } from './codex-exec-run'

// FIXTURE_ONLY: every run below drives the scripted fake; no real codex binary starts.
const runs: FakeCodexRun[] = []

function fake(steps: readonly FakeStep[]): FakeCodexRun {
  const run = createFakeCodexRun(steps)
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
  fakeEvents.threadStarted(),
  fakeEvents.turnStarted(),
  { grandchild: true, lifetimeMs: 60_000 },
  { ready: true },
  fakeEvents.agentMessage('working'),
  { hang: true }
]

const TIGHT = { graceMs: 1500, verifyMs: 3000 }

async function waitUntilDead(pid: number): Promise<boolean> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !isProcessAlive(pid)
}

/** The honest tree proof of a stopped run: POSIX proves the group, Windows only the root without a snapshot. */
const STOPPED_PROOF =
  process.platform === 'win32'
    ? { verdict: 'unverifiable', method: 'root_exit_only' }
    : { verdict: 'exited', method: 'posix_group_quiescence' }

describe('runCodexExec cancellation', () => {
  it('stops a run mid-flight through AbortSignal and kills the whole process tree', async () => {
    const run = fake(HANGING_RUN)
    const controller = new AbortController()
    const result = await runCodexExec(
      run.request(),
      run.options({
        signal: controller.signal,
        ...TIGHT,
        // The abort is requested only once the fake has reported its grandchild and is mid-run.
        onEvent: (event) => {
          if (event.kind === 'item') {
            controller.abort()
          }
        }
      })
    )
    expect(run.ready()).toBe(true)
    expect(result.verdict).toMatchObject({ status: 'failed', failures: [{ kind: 'cancelled' }] })
    expect(result.cancellation).toMatchObject({
      requested: true,
      trigger: 'abort_signal',
      spawned: true,
      rootExited: true,
      ...STOPPED_PROOF
    })
    expect(result.treeProof).toEqual(STOPPED_PROOF)
    expect(result.threadId).toBe('thread-fixture-1')
    const pid = run.grandchildPid()
    expect(pid).not.toBeNull()
    expect(await waitUntilDead(pid ?? 0)).toBe(true)
  }, 30_000)

  it('does not start a process when the signal is already aborted', async () => {
    const run = fake(HANGING_RUN)
    const controller = new AbortController()
    controller.abort()
    const result = await runCodexExec(run.request(), run.options({ signal: controller.signal }))
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
    const result = await runCodexExec(run.request(), run.options({ timeoutMs: 4000, ...TIGHT }))
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
    const pid = run.grandchildPid()
    expect(pid).not.toBeNull()
    expect(await waitUntilDead(pid ?? 0)).toBe(true)
  }, 30_000)

  // Windows closes the pipes with the root even when a helper inherited them, so this needs POSIX to run.
  it.skipIf(process.platform === 'win32')(
    'terminates a helper that holds stdout open after the root exited, and never reports completed',
    async () => {
      const run = fake([
        fakeEvents.threadStarted(),
        fakeEvents.turnStarted(),
        { grandchild: true, lifetimeMs: 60_000, inheritStdout: true },
        { lastMessage: 'ok' },
        fakeEvents.turnCompleted(),
        { exit: 0 }
      ])
      const result = await runCodexExec(
        run.request(),
        run.options({ limits: { drainGraceMs: 300 }, ...TIGHT })
      )
      expect(result.stdoutDrainTimedOut).toBe(true)
      expect(result.verdict).toMatchObject({
        status: 'failed',
        failures: [{ kind: 'descendant_outlived_root' }]
      })
      expect(result.treeProof).toEqual({ verdict: 'exited', method: 'posix_group_quiescence' })
      expect(await waitUntilDead(run.grandchildPid() ?? 0)).toBe(true)
    },
    30_000
  )

  it('ignores an abort that arrives after the run has finished', async () => {
    const run = fake([
      fakeEvents.threadStarted(),
      fakeEvents.turnStarted(),
      { lastMessage: 'ok' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const controller = new AbortController()
    const result = await runCodexExec(run.request(), run.options({ signal: controller.signal }))
    controller.abort()
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.cancellation).toEqual({ requested: false })
  })
})

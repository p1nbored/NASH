// FIXTURE_ONLY: synthetic ports in a temporary data folder; no CLI, model or credential is used.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutorStopPort } from '../workflow-run/executor-stop-port'
import { createRunsRootPort, createTaskExecutionRuntime } from './task-execution-runtime'
import {
  FIXTURE_NOW_MS,
  createAppRunHarness,
  type AppRunHarness
} from './task-execution.test-fixture'

describe('task execution runtime', () => {
  let harness: AppRunHarness
  let userData: string

  beforeEach(() => {
    harness = createAppRunHarness()
    userData = mkdtempSync(join(tmpdir(), 'task-execution-runtime-'))
  })
  afterEach(() => {
    harness.owner.close()
    rmSync(userData, { recursive: true, force: true })
  })

  function runtime() {
    const resolveExecutable = vi.fn(() => {
      throw new Error('not used in this test')
    })
    return createTaskExecutionRuntime({
      owner: harness.owner,
      routes: { recheck: vi.fn(), latch: vi.fn() },
      now: () => FIXTURE_NOW_MS,
      cliCommand: 'orca',
      userDataPath: userData,
      workspacePath: () => userData,
      worktrees: { create: vi.fn() },
      announce: () => undefined,
      log: () => undefined,
      codex: { resolveExecutable },
      agy: { resolveExecutable }
    })
  }

  it('exposes the stop port B4 registers, the quit abort, restart reconcile and the result reader', async () => {
    const built = runtime()
    const port: ExecutorStopPort = built.stopPort
    await expect(
      port.stopExecutor({ dispatchId: 'ctx_unknown00001', kind: 'codex_cli' })
    ).resolves.toEqual({
      verdict: 'unverifiable',
      method: 'root_exit_only'
    })
    await expect(built.abortAllForQuit()).resolves.toBeUndefined()
    expect(built.reconcileAfterRestart()).toMatchObject({ startUnknown: [], stopUnknown: [] })
    await expect(built.readAttemptResult('ctx_unknown00001')).resolves.toEqual({
      state: 'no_result'
    })
  })

  it('has no executable pin policy: the installed CLI starts as resolved (D-023)', () => {
    expect(runtime()).not.toHaveProperty('executablePinRequired')
  })

  it('creates one private runs folder per run under the data folder', async () => {
    const runsRoot = createRunsRootPort(userData)
    const path = await runsRoot('run_0123456789ab')
    expect(path).toBe(join(userData, 'autopilot-runs', 'run_0123456789ab'))
    expect(existsSync(path)).toBe(true)
    await expect(runsRoot('run_0123456789ab')).resolves.toBe(path)
    await expect(runsRoot('../escape')).rejects.toThrow()
  })
})

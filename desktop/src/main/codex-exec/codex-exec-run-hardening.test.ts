import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFakeCodexRun,
  successSteps,
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

function kindsOf(result: Awaited<ReturnType<typeof runCodexExec>>): string[] {
  return result.verdict.status === 'completed'
    ? []
    : result.verdict.failures.map((failure) => failure.kind)
}

describe('runCodexExec run directory policy', () => {
  it('refuses, by default, a runs root under the OS temp directory', async () => {
    const run = fake(successSteps())
    // No deps override: the fixture lives under the temp directory, which the default rule forbids.
    const result = await runCodexExec(run.request(), { executable: run.executable })
    expect(kindsOf(result)).toEqual(['run_dir_unusable'])
    expect(result.spawned).toBe(false)
    expect(existsSync(run.runDir)).toBe(false)
  })

  it('refuses a runs root inside the worktree', async () => {
    const run = fake(successSteps())
    const result = await runCodexExec(run.request({ runsRoot: run.worktree }), run.options())
    expect(kindsOf(result)).toEqual(['run_dir_unusable'])
    expect(result.spawned).toBe(false)
  })
})

describe('runCodexExec launch target checks', () => {
  it('starts the resolved launcher without any fingerprint check (D-023)', async () => {
    const run = fake(successSteps())
    const result = await runCodexExec(run.request(), run.options())
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.evidence).not.toHaveProperty('sha256')
  })

  it('refuses a hand-built executable that lives inside the worktree', async () => {
    const run = fake(successSteps())
    const planted = join(run.worktree, 'node.exe')
    const result = await runCodexExec(
      run.request(),
      run.options({ executable: { ...run.executable, program: planted } })
    )
    expect(kindsOf(result)).toEqual(['executable_not_launchable'])
    expect(result.spawned).toBe(false)
    expect(existsSync(run.runDir)).toBe(false)
  })

  it.each([
    ['a relative program', { program: 'node' }],
    ['extra prefix arguments', { prefixArgs: ['-e', 'process.exit(0)'] }]
  ])('refuses %s', async (_label, overrides) => {
    const run = fake(successSteps())
    const result = await runCodexExec(
      run.request(),
      run.options({ executable: { ...run.executable, ...overrides } })
    )
    expect(kindsOf(result)).toEqual(['executable_not_launchable'])
    expect(run.received()).toBeNull()
  })

  it('refuses the Electron binary unless it is told to act as Node', async () => {
    const run = fake(successSteps())
    const electron = { isElectron: true, execPath: process.execPath }
    const refused = await runCodexExec(run.request(), run.options({ deps: { electron } }))
    expect(kindsOf(refused)).toEqual(['executable_not_launchable'])
  })

  it('sets ELECTRON_RUN_AS_NODE for an Electron launch target, and only then', async () => {
    const electron = { isElectron: true, execPath: process.execPath }
    const asNode = fake(successSteps())
    const withFlag = await runCodexExec(
      asNode.request(),
      asNode.options({
        executable: { ...asNode.executable, electronRunAsNode: true },
        deps: { electron }
      })
    )
    expect(withFlag.verdict).toEqual({ status: 'completed' })
    expect(asNode.received()?.envNames).toContain('ELECTRON_RUN_AS_NODE')

    const plain = fake(successSteps())
    await runCodexExec(plain.request(), plain.options())
    expect(plain.received()?.envNames).not.toContain('ELECTRON_RUN_AS_NODE')
  })
})

describe('runCodexExec never rejects on hostile input', () => {
  // JSON.parse yields `any`, standing in for routing data that violates the static request type.
  it.each([
    ['a null request', 'null'],
    ['a numeric request', '5'],
    ['a request with hostile field types', '{"prompt":{},"model":[],"worktreePath":7,"runsRoot":1}']
  ])('returns a typed verdict for %s', async (_label, json) => {
    const run = fake(successSteps())
    const result = await runCodexExec(JSON.parse(json), run.options())
    expect(kindsOf(result)).toEqual(['invalid_request'])
    expect(result.spawned).toBe(false)
  })
})

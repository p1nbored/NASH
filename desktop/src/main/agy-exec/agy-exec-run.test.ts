import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectExecutableEvidence } from '../agent-exec-shared/executable-evidence'
import { describeAgyExecArgv } from './agy-exec-argv'
import {
  createFakeAgyRun,
  successSteps,
  type FakeAgyRun,
  type FakeStep
} from './agy-exec-fake-agy.test-fixture'
import { runAgyExec } from './agy-exec-run'
import {
  AGY_EXEC_OUTPUT_CEILING_BYTES,
  DEFAULT_AGY_EXEC_LIMITS,
  resolveAgyRunOptions
} from './agy-exec-run-options'

// FIXTURE_ONLY: every run below drives the scripted fake; no real agy binary starts.
const runs: FakeAgyRun[] = []

function fake(steps: readonly FakeStep[]): FakeAgyRun {
  const run = createFakeAgyRun(steps)
  runs.push(run)
  return run
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const run of runs.splice(0)) {
    run.cleanup()
  }
})

// FIXTURE_ONLY: obviously fake credential-shaped values.
const FAKE_KEY = `sk-${'FIXTURE0'.repeat(4)}`

describe('runAgyExec success', () => {
  it('completes a clean run and records the full result', async () => {
    const run = fake(successSteps('The release note is ready.\n'))
    const result = await runAgyExec(run.request(), run.options())

    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.spawned).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.exitSignal).toBeNull()
    expect(result.applied).toEqual({ model: 'gemini-3.8-flash-high', effort: null })
    expect(result.cancellation).toEqual({ requested: false })
    expect(result.timing.durationMs).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(result.timing.startedAt))).toBe(false)
    expect(result.evidence).toMatchObject({ version: '1.2.14-fixture', versionProbe: 'ok' })
    expect(result.runDir).toBe(run.runDir)
    expect(result.stdoutBytes).toBe(Buffer.byteLength('The release note is ready.\n'))
    expect(result.stdoutDrainTimedOut).toBe(false)
    expect(result.stderrTail).toBe('')
  })

  it('writes the answer under runsRoot/runId and records its path, size, hash and preview', async () => {
    const run = fake(successSteps('The release note is ready.\n'))
    const result = await runAgyExec(run.request(), run.options())
    const raw = Buffer.from('The release note is ready.\n')
    expect(result.output).toEqual({
      state: 'ok',
      path: join(run.runDir, 'output.txt'),
      bytes: raw.length,
      sha256: createHash('sha256').update(raw).digest('hex'),
      secretLike: false,
      preview: 'The release note is ready.\n',
      previewTruncated: false
    })
    expect(readFileSync(join(run.runDir, 'output.txt'))).toEqual(raw)
    expect(statSync(run.runDir).isDirectory()).toBe(true)
  })

  it('sends exactly --print=<prompt> --sandbox --model <id> in the worktree, with an empty stdin', async () => {
    const run = fake(successSteps())
    const request = run.request()
    const result = await runAgyExec(request, run.options())
    const received = run.received()
    expect(received?.argv).toEqual([
      `--print=${request.prompt}`,
      '--sandbox',
      '--model',
      'gemini-3.8-flash-high'
    ])
    expect(realpathSync(received?.cwd ?? '')).toBe(realpathSync(run.worktree))
    expect(received?.stdinBytes).toBe(0)
    expect(result.argv).toEqual(describeAgyExecArgv(received?.argv ?? []))
    expect(result.argv.join(' ')).not.toContain('draft a short release note')
  })

  it('adds --effort last when one is requested', async () => {
    const run = fake(successSteps())
    const result = await runAgyExec(
      run.request({ model: 'claude-opus-5-5-low', effort: 'max' }),
      run.options()
    )
    expect(run.received()?.argv.slice(-4)).toEqual([
      '--model',
      'claude-opus-5-5-low',
      '--effort',
      'max'
    ])
    expect(result.applied).toEqual({ model: 'claude-opus-5-5-low', effort: 'max' })
  })

  it('passes high thinking as the variant id alone, with no --effort', async () => {
    const run = fake(successSteps())
    await runAgyExec(run.request(), run.options())
    expect(run.received()?.argv).not.toContain('--effort')
  })

  it.each([
    ['a dash-leading prompt', '--dangerously-skip-permissions please\n- item'],
    ['quotes and backslashes', 'say "hi" \\ and \\\\ and "" and \\" end\\'],
    ['percent signs and carets', '%PATH% %USERNAME% ^& | < > ^'],
    ['newlines and tabs', 'line one\n\tline two\r\nline three'],
    // Built from code points so no invisible joiner sits in the source.
    ['unicode and emoji', `café 中文 ${String.fromCodePoint(0x1f600, 0x1f468, 0x200d, 0x1f4bb)}`],
    ['equals signs', '--print=again a=b=c'],
    // Each pair doubles when quoted for the command line, so this is the largest line the cap can produce.
    ['the worst-case quote expansion at the size cap', '\\"'.repeat(6000)]
  ])('delivers %s byte-exact on argv', async (_label, prompt) => {
    const run = fake(successSteps())
    const result = await runAgyExec(run.request({ prompt }), run.options())
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(run.received()?.argv[0]).toBe(`--print=${prompt}`)
  })

  it('gives the child a closed allowlist environment and a run-local temp directory', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'FIXTURE_ONLY_openai')
    vi.stubEnv('GEMINI_API_KEY', 'FIXTURE_ONLY_gemini')
    vi.stubEnv('ANTHROPIC_API_KEY', 'FIXTURE_ONLY_anthropic')
    vi.stubEnv('AGY_CLI_TOKEN', 'FIXTURE_ONLY_agy')
    vi.stubEnv('AUTOPILOT_CLEF_TOKEN', 'FIXTURE_ONLY_clef')
    vi.stubEnv('GITHUB_TOKEN', 'FIXTURE_ONLY_github')
    const run = fake(successSteps())
    const result = await runAgyExec(run.request(), run.options())
    const names = run.received()?.envNames ?? []
    for (const secret of [
      'OPENAI_API_KEY',
      'GEMINI_API_KEY',
      'ANTHROPIC_API_KEY',
      'AGY_CLI_TOKEN',
      'AUTOPILOT_CLEF_TOKEN',
      'GITHUB_TOKEN'
    ]) {
      expect(names.map((name) => name.toUpperCase())).not.toContain(secret)
    }
    expect(names.map((name) => name.toUpperCase())).not.toContain('CODEX_HOME')
    const tempName = process.platform === 'win32' ? 'TEMP' : 'TMPDIR'
    expect(run.received()?.envValues[tempName]).toBe(join(run.runDir, 'tmp'))
    expect(result.envNames).toEqual(expect.arrayContaining([tempName]))
    expect(JSON.stringify(result)).not.toContain('FIXTURE_ONLY')
  })

  it('does not carry the objective or the answer text in anything but the preview and the file', async () => {
    const run = fake(successSteps('ANSWER-SENTINEL\n'))
    const result = await runAgyExec(
      run.request({ prompt: 'OBJECTIVE-SENTINEL do it' }),
      run.options()
    )
    const serialized = JSON.stringify({ ...result, output: { ...result.output, preview: '' } })
    expect(serialized).not.toContain('OBJECTIVE-SENTINEL')
    expect(serialized).not.toContain('ANSWER-SENTINEL')
  })

  it('keeps concurrent runs apart', async () => {
    const first = fake([{ delayMs: 100 }, { stdout: 'first\n' }, { exit: 0 }])
    const second = fake([{ stdout: 'second\n' }, { exit: 0 }])
    const [a, b] = await Promise.all([
      runAgyExec(first.request(), first.options()),
      runAgyExec(second.request(), second.options())
    ])
    expect(a.output).toMatchObject({ state: 'ok', preview: 'first\n' })
    expect(b.output).toMatchObject({ state: 'ok', preview: 'second\n' })
    expect(a.runDir).not.toBe(b.runDir)
  })
})

describe('runAgyExec output and failure handling', () => {
  it('redacts the preview and the stderr tail, flags a credential shape and keeps the file byte-exact', async () => {
    const run = fake([
      { stdout: `token=${FAKE_KEY}\nrest of the answer\n` },
      { stderr: `warning with Bearer ${'A1b2C3d4'.repeat(4)}\n` },
      { exit: 0 }
    ])
    const result = await runAgyExec(run.request(), run.options())
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.output).toMatchObject({ state: 'ok', secretLike: true })
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY)
    expect(result.stderrTail).not.toContain('A1b2C3d4A1b2')
    expect(readFileSync(join(run.runDir, 'output.txt'), 'utf8')).toContain(FAKE_KEY)
  })

  it('bounds the preview and the stderr tail', async () => {
    const run = fake([
      { stdout: 'y'.repeat(50_000) },
      { stderr: `${'e'.repeat(100_000)}END-OF-STDERR` },
      { exit: 0 }
    ])
    const result = await runAgyExec(
      run.request(),
      run.options({ limits: { maxPreviewChars: 1000 } })
    )
    expect(result.output).toMatchObject({ state: 'ok', previewTruncated: true, bytes: 50_000 })
    expect(result.output.preview.length).toBeLessThanOrEqual(1000)
    expect(result.stderrTruncated).toBe(true)
    expect(result.stderrTail.length).toBeLessThanOrEqual(16 * 1024)
    expect(result.stderrTail.endsWith('END-OF-STDERR')).toBe(true)
  })

  it('fails with nonzero_exit on a non-zero code but still keeps the partial answer', async () => {
    const run = fake([{ stdout: 'partial\n' }, { exit: 3 }])
    const result = await runAgyExec(run.request(), run.options())
    expect(result.verdict).toMatchObject({ status: 'failed', failures: [{ kind: 'nonzero_exit' }] })
    expect(result.exitCode).toBe(3)
    expect(result.output).toMatchObject({ state: 'ok', preview: 'partial\n' })
  })

  it('fails with output_empty when agy prints nothing and exits 0', async () => {
    const run = fake([{ exit: 0 }])
    const result = await runAgyExec(run.request(), run.options())
    expect(result.verdict).toMatchObject({ status: 'failed', failures: [{ kind: 'output_empty' }] })
    expect(result.output).toMatchObject({ state: 'empty', path: null })
    expect(existsSync(join(run.runDir, 'output.txt'))).toBe(false)
  })

  it('maps quota and auth text on stderr of a failed run to a heuristic blocked verdict', async () => {
    const quota = fake([{ stderr: 'Error: quota exceeded\n' }, { exit: 1 }])
    expect((await runAgyExec(quota.request(), quota.options())).verdict).toMatchObject({
      status: 'blocked',
      reason: 'quota',
      heuristic: true
    })
    const auth = fake([{ stderr: 'You are not logged in\n' }, { exit: 1 }])
    expect((await runAgyExec(auth.request(), auth.options())).verdict).toMatchObject({
      status: 'blocked',
      reason: 'auth'
    })
  })

  it('does not block on quota words in the answer itself', async () => {
    const run = fake([{ stdout: 'quota exceeded, please log in\n' }, { exit: 1 }])
    expect((await runAgyExec(run.request(), run.options())).verdict).toMatchObject({
      status: 'failed'
    })
  })

  it('stops a run whose output passes the limit and reports output_oversized first', async () => {
    // The fake would write 100 GB, so only the runner stopping it can end the run; no byte count is timed.
    const run = fake([{ bigStdout: 100_000_000_000 }, { exit: 0 }])
    const result = await runAgyExec(
      run.request(),
      run.options({ limits: { maxOutputBytes: 64 * 1024 }, graceMs: 1500, verifyMs: 3000 })
    )
    expect(result.verdict).toMatchObject({
      status: 'failed',
      failures: [{ kind: 'output_oversized' }]
    })
    expect(result.output).toMatchObject({ state: 'oversized', path: null })
    expect(result.stdoutBytes).toBeGreaterThan(64 * 1024)
    expect(result.exitCode === 0 && result.exitSignal === null).toBe(false)
    expect(result.cancellation).toEqual({ requested: false })
    expect(existsSync(join(run.runDir, 'output.txt'))).toBe(false)
  }, 60_000)

  it('reports spawn_failed when the program cannot start', async () => {
    const run = fake(successSteps())
    const missing = join(run.root, 'tools', 'agy-missing.exe')
    const result = await runAgyExec(
      run.request(),
      run.options({
        executable: {
          ...run.executable,
          program: missing,
          prefixArgs: [],
          entryPath: missing,
          requestedPath: missing,
          launch: 'direct'
        }
      })
    )
    expect(result.verdict).toMatchObject({ status: 'failed', failures: [{ kind: 'spawn_failed' }] })
    expect(result.spawned).toBe(false)
    expect(result.runDir).toBe(run.runDir)
  })
})

describe('runAgyExec refusals before anything starts', () => {
  const REFUSED: readonly (readonly [string, Record<string, unknown>])[] = [
    ['a Gemini 4 id', { model: 'gemini-4-flash-high' }],
    ['a Gemini 4 label', { modelLabel: 'Gemini 4 Pro (High)' }],
    ['the default sentinel', { model: 'default' }],
    ['an alias', { model: 'latest' }],
    ['an unlisted effort', { effort: 'ultra' }],
    ['a prompt the command line cannot hold', { prompt: 'a'.repeat(140_000) }],
    ['an empty prompt', { prompt: '   ' }],
    ['an edit mode field', { mode: 'accept-edits' }],
    ['a continue field', { continue: true }],
    ['a bypass field', { dangerouslySkipPermissions: true }],
    ['a relative worktree', { worktreePath: 'relative/dir' }],
    ['a bad run id', { runId: '../escape' }]
  ]

  it.each(REFUSED)(
    'refuses %s without creating a directory or starting a process',
    async (_label, overrides) => {
      const run = fake(successSteps())
      const result = await runAgyExec(run.request(overrides), run.options())
      expect(result.verdict).toMatchObject({
        status: 'failed',
        failures: [{ kind: 'invalid_request' }]
      })
      expect(result.spawned).toBe(false)
      expect(result.applied).toBeNull()
      expect(result.runDir).toBeNull()
      expect(result.argv).toEqual([])
      expect(result.treeProof).toEqual({ verdict: 'exited', method: 'not_started' })
      expect(result.cancellation).toEqual({ requested: false })
      expect(existsSync(run.runDir)).toBe(false)
      expect(run.received()).toBeNull()
    }
  )

  it('names the Gemini 4 refusal by its pin policy code', async () => {
    const run = fake(successSteps())
    const result = await runAgyExec(run.request({ model: 'gemini-4-flash-high' }), run.options())
    expect(result.verdict).toMatchObject({
      failures: [{ kind: 'invalid_request', detail: expect.stringContaining('model_excluded') }]
    })
  })

  it('refuses a request that is not an object', async () => {
    const run = fake(successSteps())
    // @ts-expect-error FIXTURE_ONLY: untyped routing data reaches the runner.
    const result = await runAgyExec(null, run.options())
    expect(result.verdict).toMatchObject({ failures: [{ kind: 'invalid_request' }] })
  })
})

describe('runAgyExec run directory', () => {
  it('refuses to reuse an existing run directory and leaves it untouched', async () => {
    const run = fake(successSteps())
    mkdirSync(run.runDir)
    writeFileSync(join(run.runDir, 'earlier-answer.txt'), 'earlier')
    const result = await runAgyExec(run.request(), run.options())
    expect(result.verdict).toMatchObject({ failures: [{ kind: 'run_dir_unusable' }] })
    expect(result.spawned).toBe(false)
    expect(readFileSync(join(run.runDir, 'earlier-answer.txt'), 'utf8')).toBe('earlier')
    expect(run.received()).toBeNull()
  })

  it('refuses a runs root inside the worktree', async () => {
    const run = fake(successSteps())
    const inside = join(run.worktree, 'runs')
    mkdirSync(inside)
    const result = await runAgyExec(run.request({ runsRoot: inside }), run.options())
    expect(result.verdict).toMatchObject({ failures: [{ kind: 'run_dir_unusable' }] })
    expect(result.spawned).toBe(false)
  })

  it('refuses a runs root under a temp directory by default', async () => {
    const run = fake(successSteps())
    const result = await runAgyExec(
      run.request(),
      run.options({ deps: { tempRoots: () => [tmpdir()] } })
    )
    expect(result.verdict).toMatchObject({ failures: [{ kind: 'run_dir_unusable' }] })
    expect(result.spawned).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('creates the run directory owner-only', async () => {
    const run = fake(successSteps())
    await runAgyExec(run.request(), run.options())
    expect(statSync(run.runDir).mode & 0o777).toBe(0o700)
  })
})

describe('runAgyExec launch target', () => {
  it('refuses a program that lives inside the worktree, before the run directory exists', async () => {
    const run = fake(successSteps())
    const planted = join(run.worktree, 'agy.exe')
    const result = await runAgyExec(
      run.request(),
      run.options({
        executable: {
          ...run.executable,
          program: planted,
          prefixArgs: [],
          entryPath: planted,
          requestedPath: planted,
          launch: 'direct'
        }
      })
    )
    expect(result.verdict).toMatchObject({ failures: [{ kind: 'executable_not_launchable' }] })
    expect(result.spawned).toBe(false)
    expect(existsSync(run.runDir)).toBe(false)
  })

  it('starts the resolved launcher without any fingerprint check (D-023)', async () => {
    const run = fake(successSteps())
    const result = await runAgyExec(run.request(), run.options())
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.evidence).not.toHaveProperty('sha256')
  })

  it('uses evidence collected earlier instead of probing again', async () => {
    const run = fake(successSteps())
    const evidence = await collectExecutableEvidence(run.executable, { env: process.env })
    const result = await runAgyExec(run.request(), run.options({ executableEvidence: evidence }))
    expect(result.evidence).toEqual(evidence)
  })
})

describe('runAgyExec options', () => {
  it.each([
    ['a zero timeout', { timeoutMs: 0 }],
    ['a fractional grace', { graceMs: 1.5 }],
    ['an unbounded verify wait', { verifyMs: Infinity }],
    ['a timer overflow', { timeoutMs: 2 ** 31 }],
    ['a string limit', { limits: { maxOutputBytes: '5' } }],
    ['an output cap above the memory ceiling', { limits: { maxOutputBytes: 128 * 1024 * 1024 } }],
    ['a limits value that is not an object', { limits: 5 }]
  ])('refuses %s as invalid_request before anything starts', async (_label, bad) => {
    const run = fake(successSteps())
    // @ts-expect-error FIXTURE_ONLY: untyped options reach the runner.
    const result = await runAgyExec(run.request(), run.options(bad))
    expect(result.verdict).toMatchObject({ failures: [{ kind: 'invalid_request' }] })
    expect(run.received()).toBeNull()
  })

  it('defaults to a 64 MiB output ceiling, with no fixed timeout (D-027)', () => {
    expect(DEFAULT_AGY_EXEC_LIMITS.maxOutputBytes).toBe(64 * 1024 * 1024)
    expect(AGY_EXEC_OUTPUT_CEILING_BYTES).toBe(64 * 1024 * 1024)
    const resolved = resolveAgyRunOptions({ executable: fake(successSteps()).executable })
    expect(resolved.ok && resolved.value.timing.timeoutMs).toBeNull()
  })

  it('refuses a prompt the command line cannot hold, before anything starts', async () => {
    const run = fake(successSteps())
    const result = await runAgyExec(run.request({ prompt: 'a'.repeat(140_000) }), run.options())
    expect(result.verdict).toMatchObject({
      failures: [{ kind: 'invalid_request', detail: expect.stringContaining('prompt_too_large') }]
    })
    expect(run.received()).toBeNull()
  })
})

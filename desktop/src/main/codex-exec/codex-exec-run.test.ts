import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectExecutableEvidence } from '../agent-exec-shared/executable-evidence'
import {
  createFakeCodexRun,
  fakeEvents,
  successSteps,
  type FakeCodexRun,
  type FakeStep
} from './codex-exec-fake-codex.test-fixture'
import { runCodexExec } from './codex-exec-run'
import type { CodexExecNormalizedEvent } from './codex-exec-event-normalizer'

// FIXTURE_ONLY: every run below drives the scripted fake; no real codex binary starts.
const runs: FakeCodexRun[] = []

function fake(steps: readonly FakeStep[]): FakeCodexRun {
  const run = createFakeCodexRun(steps)
  runs.push(run)
  return run
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const run of runs.splice(0)) {
    run.cleanup()
  }
})

describe('runCodexExec success', () => {
  it('completes a clean run and records the full result', async () => {
    const run = fake(successSteps('final answer'))
    const result = await runCodexExec(run.request(), run.options())

    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.spawned).toBe(true)
    expect(result.threadId).toBe('thread-fixture-1')
    expect(result.threadStartedCount).toBe(1)
    expect(result.exitCode).toBe(0)
    expect(result.exitSignal).toBeNull()
    expect(result.usage).toEqual({
      inputTokens: 120,
      cachedInputTokens: 40,
      outputTokens: 30,
      reasoningOutputTokens: 10
    })
    expect(result.applied).toEqual({
      model: 'gpt-6-astra',
      effort: 'high',
      sandbox: 'read-only',
      ephemeral: false,
      outputSchema: false,
      skipGitRepoCheck: false
    })
    expect(result.reportedModel).toBeNull()
    expect(result.exactModelVerified).toBe(false)
    expect(result.cancellation).toEqual({ requested: false })
    expect(result.timing.durationMs).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(result.timing.startedAt))).toBe(false)
    expect(result.evidence).toMatchObject({ version: '0.0.0-fixture', versionProbe: 'ok' })
    expect(result.evidence).not.toHaveProperty('sha256')
    expect(result.runDir).toBe(run.runDir)
    expect(result.lastMessage).toMatchObject({
      path: join(run.runDir, 'last-message.txt'),
      state: 'ok',
      bytes: Buffer.byteLength('final answer'),
      secretLike: false
    })
    expect(result.lastMessage.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(join(run.runDir, 'last-message.txt'), 'utf8')).toBe('final answer')
    expect(result.stream.eventCount).toBe(4)
    expect(result.stream.itemCounts).toEqual({ agent_message: 1 })
    expect(result.stream.reasoningItemsOmitted).toBe(1)
    expect(JSON.stringify(result)).not.toContain('REASONING-SENTINEL')
  })

  it('never claims a verified tree on a clean exit where it can only see the root', async () => {
    const run = fake(successSteps())
    const result = await runCodexExec(run.request(), run.options())
    if (process.platform === 'win32') {
      expect(result.treeProof).toEqual({ verdict: 'unverifiable', method: 'root_exit_only' })
    } else {
      expect(result.treeProof).toEqual({ verdict: 'exited', method: 'posix_group_probe' })
    }
    expect(result.stdoutDrainTimedOut).toBe(false)
  })

  it('launches the documented argv and records exactly what the child received', async () => {
    const run = fake(successSteps())
    const result = await runCodexExec(
      run.request({ sandbox: 'workspace-write', ephemeral: true }),
      run.options()
    )
    expect(result.argv).toEqual([
      'exec',
      '--json',
      '--model',
      'gpt-6-astra',
      '-c',
      'model_reasoning_effort="high"',
      '--sandbox',
      'workspace-write',
      '--cd',
      run.worktree,
      '--ignore-user-config',
      '--ignore-rules',
      '--output-last-message',
      join(run.runDir, 'last-message.txt'),
      '--ephemeral',
      '-'
    ])
    const received = run.received()
    expect(received?.argv).toEqual(result.argv)
    expect(realpathSync.native(received?.cwd ?? '')).toBe(realpathSync.native(run.worktree))
  })

  it('delivers a Unicode prompt byte-exact on stdin and never in argv', async () => {
    const prompt = 'Résumé: 你好 🌍 — "quoted" & | ^ %PATH% $HOME `tick`\nsecond line\r\nthird'
    const run = fake(successSteps())
    const result = await runCodexExec(run.request({ prompt }), run.options())
    expect(result.verdict.status).toBe('completed')
    const received = run.received()
    expect(
      Buffer.from(received?.stdinBase64 ?? '', 'base64').equals(Buffer.from(prompt, 'utf8'))
    ).toBe(true)
    expect(received?.argv.at(-1)).toBe('-')
    expect(received?.argv.some((token) => token.includes('Résumé'))).toBe(false)
    expect(received?.argv.some((token) => token.includes('second line'))).toBe(false)
    expect(JSON.stringify(result)).not.toContain('Résumé')
  })

  it('never lets a secret-like parent variable reach the child, only the allowlist', async () => {
    // FIXTURE_ONLY values, set on the real process environment the runner reads by default.
    vi.stubEnv('OPENAI_API_KEY', 'FIXTURE_ONLY_openai')
    vi.stubEnv('CODEX_API_KEY', 'FIXTURE_ONLY_codex')
    vi.stubEnv('ANTHROPIC_API_KEY', 'FIXTURE_ONLY_anthropic')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'FIXTURE_ONLY_claude')
    vi.stubEnv('GEMINI_API_KEY', 'FIXTURE_ONLY_gemini')
    vi.stubEnv('GOOGLE_API_KEY', 'FIXTURE_ONLY_google')
    vi.stubEnv('AGY_CLI_TOKEN', 'FIXTURE_ONLY_agy')
    vi.stubEnv('AUTOPILOT_CLEF_API_KEY', 'FIXTURE_ONLY_clef')
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'FIXTURE_ONLY_aws')
    vi.stubEnv('MY_SERVICE_SECRET', 'FIXTURE_ONLY_generic')
    vi.stubEnv('UNLISTED_PLAIN_VARIABLE', 'FIXTURE_ONLY_plain')
    const run = fake(successSteps())
    const result = await runCodexExec(run.request(), run.options())
    expect(result.verdict.status).toBe('completed')
    const received = run.received()
    const names = (received?.envNames ?? []).map((name) => name.toLowerCase())
    for (const forbidden of [
      'openai_api_key',
      'codex_api_key',
      'anthropic_api_key',
      'claude_code_oauth_token',
      'gemini_api_key',
      'google_api_key',
      'agy_cli_token',
      'autopilot_clef_api_key',
      'aws_access_key_id',
      'my_service_secret',
      'unlisted_plain_variable'
    ]) {
      expect(names).not.toContain(forbidden)
    }
    expect(names.some((name) => /_(key|token|secret)$/.test(name))).toBe(false)
    expect(JSON.stringify(received)).not.toContain('FIXTURE_ONLY')
    expect(result.envNames).not.toContain('OPENAI_API_KEY')
    // The child gets a run-local temp directory, created before launch.
    const expectedTemp = join(run.runDir, 'tmp')
    const tempValue = received?.envValues.TEMP ?? received?.envValues.TMPDIR
    expect(tempValue?.toLowerCase()).toBe(expectedTemp.toLowerCase())
    expect(existsSync(expectedTemp)).toBe(true)
  })

  it('writes the output schema file, passes it, and re-validates the last message', async () => {
    const schema = {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
      additionalProperties: false
    }
    const good = fake(successSteps('{"summary":"all good"}'))
    const passed = await runCodexExec(good.request({ outputSchema: schema }), good.options())
    expect(passed.verdict).toEqual({ status: 'completed' })
    expect(passed.applied?.outputSchema).toBe(true)
    const schemaPath = join(good.runDir, 'result.schema.json')
    expect(JSON.parse(readFileSync(schemaPath, 'utf8'))).toEqual(schema)
    expect(good.received()?.argv).toContain('--output-schema')
    expect(good.received()?.argv).toContain(schemaPath)

    const bad = fake(successSteps('{"summary":42}'))
    const failed = await runCodexExec(bad.request({ outputSchema: schema }), bad.options())
    expect(failed.verdict).toMatchObject({
      status: 'failed',
      failures: [{ kind: 'output_schema_violation' }]
    })
    expect(failed.exitCode).toBe(0)
  })

  it('fails closed before spawning, and creates nothing, when the schema cannot be enforced', async () => {
    const run = fake(successSteps('{}'))
    const result = await runCodexExec(
      run.request({ outputSchema: { type: 'object', not: { type: 'string' } } }),
      run.options()
    )
    expect(result.verdict).toMatchObject({
      status: 'failed',
      failures: [{ kind: 'schema_unvalidatable' }]
    })
    expect(result.spawned).toBe(false)
    expect(run.received()).toBeNull()
    expect(existsSync(run.runDir)).toBe(false)
  })

  it('refuses to reuse a run directory, so a stale last message can never satisfy the rule', async () => {
    const run = fake(successSteps())
    mkdirSync(run.runDir)
    writeFileSync(join(run.runDir, 'last-message.txt'), 'stale answer from an earlier run')
    const result = await runCodexExec(run.request(), run.options())
    expect(result.verdict).toMatchObject({
      status: 'failed',
      failures: [{ kind: 'run_dir_unusable' }]
    })
    expect(result.spawned).toBe(false)
    expect(readFileSync(join(run.runDir, 'last-message.txt'), 'utf8')).toBe(
      'stale answer from an earlier run'
    )
  })

  it('flags a last message that holds a credential shape, without altering the file', async () => {
    const leaked = 'config token: ghp_FIXTUREONLYFIXTUREONLYFIXTUREONLY1234'
    const run = fake(successSteps(leaked))
    const result = await runCodexExec(run.request(), run.options())
    expect(result.verdict).toEqual({ status: 'completed' })
    expect(result.lastMessage).toMatchObject({ state: 'ok', secretLike: true })
    expect(readFileSync(join(run.runDir, 'last-message.txt'), 'utf8')).toBe(leaked)
    expect(JSON.stringify(result)).not.toContain('FIXTUREONLYFIXTURE')
  })

  it('records a reported model only when an event reports it, and never invents one', async () => {
    const reported = fake([
      fakeEvents.threadStarted(),
      { event: { type: 'turn.started', model: 'gpt-6-astra' } },
      ...successSteps().slice(2)
    ])
    const matching = await runCodexExec(reported.request(), reported.options())
    expect(matching.reportedModel).toBe('gpt-6-astra')
    expect(matching.exactModelVerified).toBe(true)

    const rerouted = fake([
      fakeEvents.threadStarted(),
      { event: { type: 'turn.started', model: 'gpt-6.1-sol' } },
      ...successSteps().slice(2)
    ])
    const different = await runCodexExec(rerouted.request(), rerouted.options())
    expect(different.reportedModel).toBe('gpt-6.1-sol')
    expect(different.applied?.model).toBe('gpt-6-astra')
    expect(different.exactModelVerified).toBe(false)
  })

  it('reuses supplied executable evidence instead of probing again', async () => {
    const run = fake(successSteps())
    const evidence = await collectExecutableEvidence(run.executable, { env: process.env })
    const result = await runCodexExec(
      run.request(),
      run.options({ executableEvidence: { ...evidence, versionText: 'codex-cli pinned-for-test' } })
    )
    expect(result.evidence?.versionText).toBe('codex-cli pinned-for-test')
  })

  it('streams normalized events to onEvent, without reasoning', async () => {
    const run = fake(successSteps())
    const seen: CodexExecNormalizedEvent[] = []
    await runCodexExec(run.request(), run.options({ onEvent: (event) => void seen.push(event) }))
    expect(seen.map((event) => event.kind)).toEqual([
      'thread_started',
      'turn_started',
      'item',
      'turn_completed'
    ])
  })

  it('survives a throwing onEvent listener and counts the error', async () => {
    const run = fake(successSteps())
    const result = await runCodexExec(
      run.request(),
      run.options({
        onEvent: () => {
          throw new Error('listener failed')
        }
      })
    )
    expect(result.verdict.status).toBe('completed')
    expect(result.listenerErrorCount).toBe(4)
  })

  it('parses events that arrive split across pipe writes', async () => {
    const whole = JSON.stringify({ type: 'turn.started' })
    const run = fake([
      fakeEvents.threadStarted(),
      { stdoutParts: [whole.slice(0, 7), whole.slice(7, 15), `${whole.slice(15)}\n`], gapMs: 15 },
      { lastMessage: 'ok' },
      fakeEvents.turnCompleted(),
      { exit: 0 }
    ])
    const result = await runCodexExec(run.request(), run.options())
    expect(result.verdict.status).toBe('completed')
    expect(result.stream.turnStartedCount).toBe(1)
  })
})

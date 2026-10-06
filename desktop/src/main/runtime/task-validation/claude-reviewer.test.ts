import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LaunchTarget } from '../../agent-exec-shared/launch-target'
import { createClaudeReviewer, type ClaudeReviewerDeps } from './claude-reviewer'
import { REVIEW_OUTPUT_SCHEMA } from './model-review-verdict'
import type { ReviewerRequest } from './reviewer-runner'
import { sha256Of } from './task-validation.test-fixture'

// FIXTURE_ONLY: a scripted node stand-in; no real Claude CLI, model or credential is involved.
const FAKE_CLAUDE = join(__dirname, '__fixtures__', 'fake-claude-review.mjs')
const RUN_ID = 'review-0001'

const fakeLaunch: LaunchTarget = {
  program: process.execPath,
  prefixArgs: [FAKE_CLAUDE],
  entryPath: FAKE_CLAUDE,
  requestedPath: FAKE_CLAUDE,
  launch: 'node-entry'
}

const envelope = (result: string): string =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    modelUsage: { 'claude-opus-5-5': {} }
  })

describe('headless Claude reviewer', () => {
  let base: string
  let runsRoot: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'c5-claude-'))
    runsRoot = join(base, 'runs')
    mkdirSync(runsRoot)
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  function scenario(value: Record<string, unknown>): void {
    writeFileSync(join(runsRoot, 'fake-claude-scenario.json'), JSON.stringify(value))
  }

  function reviewer(overrides: Partial<ClaudeReviewerDeps> = {}) {
    return createClaudeReviewer({
      runsRoot,
      resolveExecutable: () => fakeLaunch,
      tempRoots: () => [],
      termination: { captureWindowsTree: async () => null },
      ...overrides
    })
  }

  const request = (overrides: Partial<ReviewerRequest> = {}): ReviewerRequest => ({
    prompt: 'Fixture review prompt.',
    model: 'claude-opus-5-5',
    effort: 'high',
    workspacePath: null,
    runId: RUN_ID,
    outputSchema: REVIEW_OUTPUT_SCHEMA,
    ...overrides
  })

  function received(): { argv: string[]; stdin: string; cwd: string; envNames: string[] } {
    return JSON.parse(readFileSync(join(runsRoot, RUN_ID, 'fake-received.json'), 'utf8'))
  }

  it('runs print mode with default settings in a fresh run directory with the prompt on stdin', async () => {
    scenario({ stdout: envelope('{"verdict":"pass"}') })
    expect(await reviewer()(request())).toEqual({
      status: 'completed',
      text: '{"verdict":"pass"}',
      outputSha256: sha256Of('{"verdict":"pass"}'),
      reportedModels: ['claude-opus-5-5']
    })
    const seen = received()
    expect(seen.argv).toEqual([
      '-p',
      '--output-format',
      'json',
      '--model',
      'claude-opus-5-5',
      '--effort',
      'high',
      '--no-session-persistence'
    ])
    expect(seen.stdin).toBe('Fixture review prompt.')
    expect(seen.cwd.toLowerCase()).toBe(join(runsRoot, RUN_ID).toLowerCase())
    expect(seen.envNames.some((name) => /KEY|TOKEN|SECRET|ANTHROPIC/i.test(name))).toBe(false)
  })

  it('reports a nonzero exit, an unusable envelope and a timeout as failed', async () => {
    scenario({ stdout: envelope('x'), exit: 1 })
    expect(await reviewer()(request())).toEqual({ status: 'failed', reason: 'nonzero_exit' })
    rmSync(join(runsRoot, RUN_ID), { recursive: true, force: true })
    scenario({ stdout: 'plain text' })
    expect(await reviewer()(request())).toEqual({
      status: 'failed',
      reason: 'review_output_invalid'
    })
    rmSync(join(runsRoot, RUN_ID), { recursive: true, force: true })
    scenario({ hang: true })
    expect(await reviewer({ timeoutMs: 400 })(request())).toEqual({
      status: 'failed',
      reason: 'timed_out'
    })
  })

  it('starts nothing for a bad model, a missing CLI or a launch it must refuse', async () => {
    scenario({ stdout: envelope('x') })
    expect(await reviewer()(request({ model: 'opus' }))).toEqual({
      status: 'unavailable',
      reason: 'invalid_request'
    })
    expect(await reviewer({ resolveExecutable: () => null })(request())).toEqual({
      status: 'unavailable',
      reason: 'cli_missing'
    })
    const relative: LaunchTarget = {
      ...fakeLaunch,
      program: 'claude.exe',
      launch: 'direct',
      prefixArgs: []
    }
    expect(
      await reviewer({ resolveExecutable: () => relative })(request({ runId: 'review-0002' }))
    ).toEqual({
      status: 'unavailable',
      reason: 'cli_not_launchable'
    })
    for (const runId of [RUN_ID, 'review-0002']) {
      expect(existsSync(join(runsRoot, runId, 'fake-received.json'))).toBe(false)
    }
  })

  it('refuses to reuse a run directory', async () => {
    scenario({ stdout: envelope('x') })
    mkdirSync(join(runsRoot, RUN_ID))
    expect(await reviewer()(request())).toEqual({
      status: 'unavailable',
      reason: 'run_dir_unusable'
    })
  })
})

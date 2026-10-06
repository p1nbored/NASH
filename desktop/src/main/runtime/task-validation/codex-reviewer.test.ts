import { afterEach, describe, expect, it } from 'vitest'
import {
  createFakeCodexRun,
  successSteps,
  type FakeCodexRun
} from '../../codex-exec/codex-exec-fake-codex.test-fixture'
import { runCodexExec } from '../../codex-exec/codex-exec-run'
import type { CodexExecutable } from '../../codex-exec/codex-exec-executable'
import { createCodexReviewer, type CodexReviewRun } from './codex-reviewer'
import { REVIEW_OUTPUT_SCHEMA } from './model-review-verdict'
import type { ReviewerRequest } from './reviewer-runner'
import { sha256Of } from './task-validation.test-fixture'

const REVIEW = JSON.stringify({
  verdict: 'pass',
  criteria: [{ index: 1, met: true, reason: 'The report exists.' }],
  summary: 'The work meets its criterion.'
})

describe('Codex reviewer', () => {
  let fake: FakeCodexRun | null = null
  afterEach(() => fake?.cleanup())

  function request(overrides: Partial<ReviewerRequest> = {}): ReviewerRequest {
    return {
      prompt: 'Fixture review prompt.',
      model: 'gpt-6.1-sol',
      effort: 'high',
      workspacePath: fake?.worktree ?? null,
      runId: fake?.runId ?? 'run-0001',
      outputSchema: REVIEW_OUTPUT_SCHEMA,
      ...overrides
    }
  }

  it("runs codex exec with codex's own default sandbox, explicit effort, the prompt on stdin, and the review schema (D-027 restriction 30)", async () => {
    fake = createFakeCodexRun(successSteps(REVIEW))
    const current = fake
    const reviewer = createCodexReviewer({
      runsRoot: current.runsRoot,
      resolveExecutable: () => current.executable,
      runOptions: current.options()
    })
    expect(await reviewer(request())).toEqual({
      status: 'completed',
      text: REVIEW,
      outputSha256: sha256Of(REVIEW),
      reportedModels: []
    })
    const received = current.received()
    expect(received?.argv).toEqual(expect.arrayContaining(['--model', 'gpt-6.1-sol', '-']))
    expect(received?.argv).not.toContain('--sandbox')
    expect(received?.argv).toContain('model_reasoning_effort="high"')
    expect(received?.argv).toContain('--output-schema')
    expect(Buffer.from(received?.stdinBase64 ?? '', 'base64').toString('utf8')).toBe(
      'Fixture review prompt.'
    )
  })

  it.each([
    ['folder', true],
    ['git', false]
  ] as const)(
    'in a %s workspace, skips codex`s git-repository check: %s (D-027)',
    async (workspaceKind, skips) => {
      fake = createFakeCodexRun(successSteps(REVIEW))
      const current = fake
      const reviewer = createCodexReviewer({
        runsRoot: current.runsRoot,
        resolveExecutable: () => current.executable,
        runOptions: current.options()
      })
      await reviewer(request({ workspaceKind }))
      expect(current.received()?.argv.includes('--skip-git-repo-check')).toBe(skips)
    }
  )

  it('reports a run whose output breaks the review schema as failed', async () => {
    fake = createFakeCodexRun(successSteps('{"verdict":"maybe"}'))
    const current = fake
    const reviewer = createCodexReviewer({
      runsRoot: current.runsRoot,
      resolveExecutable: () => current.executable,
      runOptions: current.options()
    })
    expect(await reviewer(request())).toEqual({
      status: 'failed',
      reason: 'output_schema_violation'
    })
  })

  it('passes a blocked verdict through, so the caller can latch the route', async () => {
    const run: CodexReviewRun = async () => ({
      verdict: {
        status: 'blocked',
        reason: 'quota',
        heuristic: true,
        matchedText: 'quota exceeded',
        failures: [{ kind: 'nonzero_exit', detail: 'The run exited with code 1.' }]
      },
      lastMessage: { state: 'not_read', path: null, bytes: null, sha256: null, secretLike: null },
      reportedModel: null
    })
    const reviewer = createCodexReviewer({
      runsRoot: 'C:/runs',
      resolveExecutable: () => fakeExecutable(),
      run
    })
    expect(await reviewer(request({ workspacePath: 'C:/repo' }))).toEqual({
      status: 'blocked',
      reason: 'quota'
    })
  })

  it('starts nothing without a workspace, an effort or an executable', async () => {
    let started = 0
    const run: typeof runCodexExec = async (...args) => {
      started += 1
      return runCodexExec(...args)
    }
    const reviewer = createCodexReviewer({
      runsRoot: 'C:/runs',
      resolveExecutable: () => fakeExecutable(),
      run
    })
    expect(await reviewer(request({ workspacePath: null }))).toEqual({
      status: 'unavailable',
      reason: 'workspace_unavailable'
    })
    expect(await reviewer(request({ workspacePath: 'C:/repo', effort: null }))).toEqual({
      status: 'unavailable',
      reason: 'effort_unresolved'
    })
    const missing = createCodexReviewer({
      runsRoot: 'C:/runs',
      resolveExecutable: () => {
        throw new Error('codex not found')
      },
      run
    })
    expect(await missing(request({ workspacePath: 'C:/repo' }))).toEqual({
      status: 'unavailable',
      reason: 'cli_missing'
    })
    expect(started).toBe(0)
  })
})

function fakeExecutable(): CodexExecutable {
  return {
    program: 'C:/fake/codex.exe',
    prefixArgs: [],
    entryPath: 'C:/fake/codex.exe',
    requestedPath: 'C:/fake/codex.exe',
    launch: 'direct',
    source: 'explicit',
    electronRunAsNode: false
  }
}

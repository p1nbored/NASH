import { describe, expect, it, vi } from 'vitest'
import type { ProcessSpec } from '../../../shared/child-process/run-process'
import { createClaudeReviewer } from './claude-reviewer'
import { REVIEW_OUTPUT_SCHEMA } from './model-review-verdict'
import type { ReviewerRequest } from './reviewer-runner'
const REVIEW = '{"verdict":"pass","criteria":[],"summary":"Done."}'
const request: ReviewerRequest = {
  prompt: 'Exact task evidence.',
  model: 'fixture-claude-model',
  effort: 'max',
  workspacePath: '/fixture/workspace',
  runId: 'review-claude',
  outputSchema: REVIEW_OUTPUT_SCHEMA
}
function fixture() {
  const run = vi.fn(async (spec: ProcessSpec) => {
    spec.onChildTerminated?.()
    return {
      code: 0,
      signal: null,
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: REVIEW,
        modelUsage: { 'fixture-claude-model': {} }
      }),
      stderr: '',
      timedOut: false
    }
  })
  const resolveInvocation = vi.fn(async () => ({
    command: 'claude',
    env: {
      CLAUDE_CONFIG_DIR: '/fixture/selected-account',
      ANTHROPIC_BASE_URL: 'https://fixture.invalid'
    }
  }))
  return { run, resolveInvocation, review: createClaudeReviewer({ run, resolveInvocation }) }
}
describe('Claude reviewer using Orca native one-shot primitives', () => {
  it('uses the selected native account and read-only plan mode in the actual workspace', async () => {
    const f = fixture()
    await expect(f.review(request)).resolves.toMatchObject({
      status: 'completed',
      text: REVIEW,
      reportedModels: ['fixture-claude-model']
    })
    expect(f.resolveInvocation).toHaveBeenCalledWith('claude')
    expect(f.run.mock.calls[0]![0]).toMatchObject({
      cwd: request.workspacePath,
      input: request.prompt,
      terminationBarrier: true,
      env: {
        CLAUDE_CONFIG_DIR: '/fixture/selected-account',
        ANTHROPIC_BASE_URL: 'https://fixture.invalid'
      }
    })
    expect(f.run.mock.calls[0]![0].args).toEqual(
      expect.arrayContaining([
        '-p',
        '--output-format',
        'json',
        '--permission-mode',
        'plan',
        '--effort',
        'max'
      ])
    )
  })
  it('keeps provider errors and malformed result envelopes out of review verdicts', async () => {
    const f = fixture()
    f.run.mockImplementationOnce(async (spec) => {
      spec.onChildTerminated?.()
      return {
        code: 0,
        signal: null,
        stdout: '{"type":"result","subtype":"error","result":"pass"}',
        stderr: '',
        timedOut: false
      }
    })
    await expect(f.review(request)).resolves.toEqual({
      status: 'failed',
      reason: 'review_output_invalid'
    })
  })
  it('re-reads account preparation for each review and never launches after preparation refusal', async () => {
    const run = vi.fn()
    const resolveInvocation = vi.fn(async () => { throw new Error('account unavailable') })
    const review = createClaudeReviewer({ run, resolveInvocation })
    await expect(review(request)).resolves.toEqual({
      status: 'unavailable',
      reason: 'account_unavailable'
    })
    await review(request)
    expect(resolveInvocation).toHaveBeenCalledTimes(2)
    expect(run).not.toHaveBeenCalled()
  })
})

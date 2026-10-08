import { describe, expect, it, vi } from 'vitest'
import { runProcess, type ProcessSpec, type ProcessResult } from '../../../shared/child-process/run-process'
import { createCodexReviewer } from './codex-reviewer'
import { REVIEW_OUTPUT_SCHEMA } from './model-review-verdict'
import type { ReviewerRequest } from './reviewer-runner'
import { sha256Of } from './task-validation.test-fixture'

const REVIEW = '{"verdict":"pass","criteria":[],"summary":"Done."}'
const request = (overrides: Partial<ReviewerRequest> = {}): ReviewerRequest => ({
  prompt: 'Review this exact task context.',
  model: 'fixture-dynamic-model',
  effort: 'max',
  workspacePath: '/fixture/workspace',
  workspaceKind: 'folder',
  runId: 'review-fixture',
  outputSchema: REVIEW_OUTPUT_SCHEMA,
  ...overrides
})
const answer = (overrides: Partial<ProcessResult> = {}): ProcessResult => ({
  code: 0,
  signal: null,
  stdout: REVIEW,
  stderr: '',
  timedOut: false,
  ...overrides
})
function fixture() {
  const run = vi.fn(async (spec: ProcessSpec) => {
    spec.onChildTerminated?.()
    return answer()
  })
  const resolveInvocation = vi.fn(async () => ({
    command: 'codex',
    env: { CODEX_HOME: '/fixture/native-codex-home', CUSTOM_PROVIDER_SETTING: 'kept' }
  }))
  return { run, resolveInvocation, review: createCodexReviewer({ run, resolveInvocation }) }
}

describe('Codex reviewer using Orca native one-shot primitives', () => {
  it('preserves routed preferences, native read-only flags, account environment and raw output', async () => {
    const f = fixture()
    expect(await f.review(request())).toEqual({
      status: 'completed',
      text: REVIEW,
      outputSha256: sha256Of(REVIEW),
      reportedModels: []
    })
    expect(f.resolveInvocation).toHaveBeenCalledWith('codex')
    const spec = f.run.mock.calls[0]![0]
    expect(spec).toMatchObject({
      cwd: '/fixture/workspace',
      input: request().prompt,
      terminationBarrier: true,
      killOnOutputLimit: true,
      env: { CODEX_HOME: '/fixture/native-codex-home', CUSTOM_PROVIDER_SETTING: 'kept' }
    })
    expect(spec.args).toEqual(
      expect.arrayContaining([
        'exec',
        '--ephemeral',
        '-s',
        'read-only',
        '--model',
        request().model,
        'model_reasoning_effort=max'
      ])
    )
    expect(spec.args).not.toContain('--ignore-user-config')
    expect(spec.args).not.toContain('--ignore-rules')
  })
  it.each(['auth', 'quota'] as const)('preserves route blocking for %s errors', async (reason) => {
    const f = fixture()
    f.run.mockImplementationOnce(async (spec) => {
      spec.onChildTerminated?.()
      return answer({
        code: 1,
        stderr: reason === 'auth' ? '401 Unauthorized' : 'insufficient_quota'
      })
    })
    await expect(f.review(request())).resolves.toEqual({ status: 'blocked', reason })
  })
  it.each([
    [{ timedOut: true }, 'timed_out'],
    [{ outputTruncated: true }, 'output_oversized'],
    [{ code: 2 }, 'nonzero_exit'],
    [{ stdout: '' }, 'review_output_missing']
  ] as const)('keeps unsuccessful native outcomes visible', async (result, reason) => {
    const f = fixture()
    f.run.mockImplementationOnce(async (spec) => {
      spec.onChildTerminated?.()
      return answer(result)
    })
    await expect(f.review(request())).resolves.toEqual({ status: 'failed', reason })
  })
  it('never launches an already canceled review or one without an available workspace', async () => {
    const f = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(f.review(request({ signal: controller.signal }))).resolves.toEqual({
      status: 'failed',
      reason: 'cancelled'
    })
    await expect(f.review(request({ workspacePath: null }))).resolves.toEqual({
      status: 'unavailable',
      reason: 'workspace_unavailable'
    })
    expect(f.run).not.toHaveBeenCalled()
  })
  it('holds the native Codex home lock until the child exit callback, even after publishing a result', async () => {
    const f = fixture()
    let closeFirst!: () => void
    f.run.mockImplementationOnce(async (spec) => {
      closeFirst = spec.onChildTerminated!
      return answer()
    })
    await f.review(request())
    const second = f.review(request({ runId: 'review-second' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(f.run).toHaveBeenCalledTimes(1)
    closeFirst()
    await second
    expect(f.run).toHaveBeenCalledTimes(2)
  })
  it('passes cancellation to the native runner without sharing another review signal', async () => {
    const f = fixture()
    const a = new AbortController()
    const b = new AbortController()
    await f.review(request({ signal: a.signal }))
    await f.review(request({ signal: b.signal }))
    expect(f.run.mock.calls[0]![0].signal).toBe(a.signal)
    expect(f.run.mock.calls[1]![0].signal).toBe(b.signal)
  })
})

it('executes a harmless Node stand-in through the real Orca process runner', async () => {
  const review = createCodexReviewer({
    resolveInvocation: async () => ({ command: process.execPath, env: { ...process.env, FIXTURE_REVIEW: REVIEW } }),
    run: (spec) => runProcess({ ...spec, args: ['-e', 'process.stdout.write(process.env.FIXTURE_REVIEW)'] })
  })
  await expect(review(request({ workspacePath: process.cwd() }))).resolves.toMatchObject({ status: 'completed', text: REVIEW })
})
it('cancels a harmless running Node stand-in through the native termination barrier', async () => {
  const controller = new AbortController()
  const review = createCodexReviewer({
    resolveInvocation: async () => ({ command: process.execPath, env: { ...process.env } }),
    run: (spec) => runProcess({ ...spec, args: ['-e', 'setInterval(()=>{},1000)'] })
  })
  const timer = setTimeout(() => controller.abort(), 150)
  try { await expect(review(request({ workspacePath: process.cwd(), signal: controller.signal }))).resolves.toEqual({ status: 'failed', reason: 'cancelled' }) }
  finally { clearTimeout(timer) }
})
it('cancels while queued without releasing the previous Codex lock or launching later', async () => {
  const f = fixture(); let closeFirst!: () => void
  f.run.mockImplementationOnce(async (spec) => { closeFirst = spec.onChildTerminated!; return answer() })
  await f.review(request())
  const controller = new AbortController()
  const queued = f.review(request({ signal: controller.signal }))
  await Promise.resolve(); await Promise.resolve(); controller.abort()
  try {
    await expect(queued).resolves.toEqual({ status: 'failed', reason: 'cancelled' })
    expect(f.run).toHaveBeenCalledTimes(1)
  } finally { closeFirst() }
  await f.review(request())
  expect(f.run).toHaveBeenCalledTimes(2)
})

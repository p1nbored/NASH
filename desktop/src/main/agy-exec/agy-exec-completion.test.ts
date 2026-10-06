import { describe, expect, it } from 'vitest'
import { evaluateAgyExecCompletion, type AgyExecCompletionInput } from './agy-exec-completion'
import type { AgyExecOutputRecord } from './agy-exec-types'

const OK_OUTPUT: AgyExecOutputRecord = {
  state: 'ok',
  path: '/runs/r1/output.txt',
  bytes: 12,
  sha256: 'a'.repeat(64),
  secretLike: false,
  preview: 'final answer',
  previewTruncated: false
}

const NO_OUTPUT = (state: 'empty' | 'oversized' | 'unwritable'): AgyExecOutputRecord => ({
  state,
  path: null,
  bytes: state === 'oversized' ? 99 : null,
  sha256: null,
  secretLike: null,
  preview: '',
  previewTruncated: false
})

function input(overrides: Partial<AgyExecCompletionInput> = {}): AgyExecCompletionInput {
  return {
    exitCode: 0,
    exitSignal: null,
    output: OK_OUTPUT,
    stderrTail: '',
    descendantOutlivedRoot: false,
    ...overrides
  }
}

describe('evaluateAgyExecCompletion', () => {
  it('completes on a clean exit with non-empty output', () => {
    expect(evaluateAgyExecCompletion(input())).toEqual({ status: 'completed' })
  })

  it('still completes when the output is credential-shaped: that is a flag, not a failure', () => {
    expect(
      evaluateAgyExecCompletion(input({ output: { ...OK_OUTPUT, secretLike: true } }))
    ).toEqual({
      status: 'completed'
    })
  })

  it('fails with nonzero_exit on a non-zero code and on a signal', () => {
    expect(evaluateAgyExecCompletion(input({ exitCode: 2 }))).toMatchObject({
      status: 'failed',
      failures: [{ kind: 'nonzero_exit', detail: expect.stringContaining('exit code 2') }]
    })
    expect(
      evaluateAgyExecCompletion(input({ exitCode: null, exitSignal: 'SIGKILL' }))
    ).toMatchObject({
      status: 'failed',
      failures: [{ kind: 'nonzero_exit', detail: expect.stringContaining('SIGKILL') }]
    })
  })

  it.each([
    ['empty', 'output_empty'],
    ['unwritable', 'output_unwritable']
  ] as const)('fails with %s output as %s', (state, kind) => {
    expect(evaluateAgyExecCompletion(input({ output: NO_OUTPUT(state) }))).toMatchObject({
      status: 'failed',
      failures: [{ kind }]
    })
  })

  it('names oversized output first and does not blame the exit the runner caused by stopping the child', () => {
    const verdict = evaluateAgyExecCompletion(
      input({ exitCode: null, exitSignal: 'SIGKILL', output: NO_OUTPUT('oversized') })
    )
    expect(verdict).toMatchObject({ status: 'failed', failures: [{ kind: 'output_oversized' }] })
    if (verdict.status === 'failed') {
      expect(verdict.failures.map((failure) => failure.kind)).toEqual(['output_oversized'])
    }
  })

  it('never reports completed when a helper outlived the root', () => {
    const verdict = evaluateAgyExecCompletion(input({ descendantOutlivedRoot: true }))
    expect(verdict).toMatchObject({
      status: 'failed',
      failures: [{ kind: 'descendant_outlived_root' }]
    })
  })

  it('lists every violated clause with the exit first', () => {
    const verdict = evaluateAgyExecCompletion(
      input({ exitCode: 1, descendantOutlivedRoot: true, output: NO_OUTPUT('empty') })
    )
    expect(verdict.status === 'failed' && verdict.failures.map((failure) => failure.kind)).toEqual([
      'nonzero_exit',
      'descendant_outlived_root',
      'output_empty'
    ])
  })

  it('marks a failed run blocked from stderr text, flagged as a heuristic', () => {
    const verdict = evaluateAgyExecCompletion(
      input({ exitCode: 1, output: NO_OUTPUT('empty'), stderrTail: 'Error: quota exceeded' })
    )
    expect(verdict).toMatchObject({ status: 'blocked', reason: 'quota', heuristic: true })
  })

  it('never reads agent output as a block signal, and never blocks a completed run', () => {
    const talky = { ...OK_OUTPUT, preview: 'quota exceeded, please log in' }
    expect(evaluateAgyExecCompletion(input({ exitCode: 1, output: talky }))).toMatchObject({
      status: 'failed'
    })
    expect(evaluateAgyExecCompletion(input({ stderrTail: 'quota exceeded' }))).toEqual({
      status: 'completed'
    })
  })
})

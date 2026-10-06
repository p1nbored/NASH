import { detectAgyExecBlock } from './agy-exec-blocked-heuristics'
import type {
  AgyExecFailure,
  AgyExecFailures,
  AgyExecOutputRecord,
  AgyExecVerdict
} from './agy-exec-types'

export type AgyExecCompletionInput = {
  readonly exitCode: number | null
  readonly exitSignal: NodeJS.Signals | null
  readonly output: AgyExecOutputRecord
  readonly stderrTail: string
  /** A helper held the output open or lived on after the root exited; it may still write. */
  readonly descendantOutlivedRoot: boolean
}

function failure(kind: AgyExecFailure['kind'], detail: string): AgyExecFailure {
  return { kind, detail }
}

function exitFailures(input: AgyExecCompletionInput): AgyExecFailure[] {
  if (input.exitCode === 0 && input.exitSignal === null) {
    return []
  }
  const how =
    input.exitSignal === null
      ? `exit code ${input.exitCode ?? 'unknown'}`
      : `signal ${input.exitSignal}`
  return [failure('nonzero_exit', `The process ended with ${how}.`)]
}

function containmentFailures(input: AgyExecCompletionInput): AgyExecFailure[] {
  return input.descendantOutlivedRoot
    ? [
        failure(
          'descendant_outlived_root',
          'A helper process outlived the root and may still write.'
        )
      ]
    : []
}

function outputFailures(output: AgyExecOutputRecord): AgyExecFailure[] {
  switch (output.state) {
    case 'ok':
    case 'not_read':
      return []
    case 'empty':
      return [failure('output_empty', 'agy wrote nothing to stdout.')]
    case 'oversized':
      return [
        failure('output_oversized', `The output passed the limit after ${output.bytes ?? 0} bytes.`)
      ]
    case 'unwritable':
      return [failure('output_unwritable', 'The output could not be written to the run directory.')]
  }
}

function asFailures(found: readonly AgyExecFailure[]): AgyExecFailures | null {
  const [first, ...rest] = found
  return first === undefined ? null : [first, ...rest]
}

/**
 * Completion rule: a clean exit, no surviving helper and a non-empty answer within the limit.
 * An oversized answer is named first and the exit it caused is not blamed, since the runner stopped the child.
 */
export function evaluateAgyExecCompletion(input: AgyExecCompletionInput): AgyExecVerdict {
  const oversized = input.output.state === 'oversized'
  const failures = asFailures(
    oversized
      ? [...outputFailures(input.output), ...containmentFailures(input)]
      : [...exitFailures(input), ...containmentFailures(input), ...outputFailures(input.output)]
  )
  if (failures === null) {
    return { status: 'completed' }
  }
  const block = detectAgyExecBlock([input.stderrTail])
  return block === null
    ? { status: 'failed', failures }
    : {
        status: 'blocked',
        reason: block.reason,
        heuristic: true,
        matchedText: block.matchedText,
        failures
      }
}

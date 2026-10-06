import { detectCodexExecBlock } from './codex-exec-blocked-heuristics'
import type { CodexExecLastMessageCheck } from './codex-exec-last-message'
import type { CodexExecStreamSummary } from './codex-exec-stream-state'
import type { CodexExecFailure, CodexExecFailures, CodexExecVerdict } from './codex-exec-types'

export type CodexExecSchemaCheck =
  | { readonly kind: 'not_required' }
  | { readonly kind: 'passed' }
  | { readonly kind: 'failed'; readonly detail: string }
  | { readonly kind: 'unvalidatable'; readonly detail: string }

export type CodexExecCompletionInput = {
  readonly exitCode: number | null
  readonly exitSignal: NodeJS.Signals | null
  readonly stream: CodexExecStreamSummary
  readonly lastMessage: CodexExecLastMessageCheck
  readonly schemaCheck: CodexExecSchemaCheck
  readonly stderrTail: string
  /** A helper held the output open or lived on after the root exited; it may still write. */
  readonly descendantOutlivedRoot: boolean
}

function failure(kind: CodexExecFailure['kind'], detail: string): CodexExecFailure {
  return { kind, detail }
}

function exitFailures(input: CodexExecCompletionInput): CodexExecFailure[] {
  if (input.exitCode === 0 && input.exitSignal === null) {
    return []
  }
  const how =
    input.exitSignal === null
      ? `exit code ${input.exitCode ?? 'unknown'}`
      : `signal ${input.exitSignal}`
  return [failure('nonzero_exit', `The process ended with ${how}.`)]
}

function streamFailures(stream: CodexExecStreamSummary): CodexExecFailure[] {
  const found: CodexExecFailure[] = []
  if (stream.threadStartedCount === 0) {
    found.push(failure('missing_thread_started', 'No thread.started event was seen.'))
  } else if (stream.threadStartedCount > 1) {
    found.push(
      failure(
        'duplicate_thread_started',
        `${stream.threadStartedCount} thread.started events were seen.`
      )
    )
  }
  if (stream.turnFailedCount > 0) {
    found.push(failure('turn_failed', `${stream.turnFailedCount} turn.failed event(s) were seen.`))
  }
  if (stream.errorEventCount > 0) {
    found.push(failure('error_event', `${stream.errorEventCount} error event(s) were seen.`))
  }
  if (stream.oversizedControlEvent) {
    found.push(
      failure(
        'oversized_control_event',
        'An oversized line was, or could not be ruled out as, a control event.'
      )
    )
  }
  if (stream.malformedControlEvent) {
    found.push(
      failure('malformed_control_event', 'A line that did not parse named a control event.')
    )
  }
  // A failure or error event already explains why no clean final turn.completed exists.
  const explained = stream.turnFailedCount > 0 || stream.errorEventCount > 0
  if (!explained && stream.finalTurnEvent !== 'turn.completed') {
    found.push(
      failure('missing_final_turn_completed', 'The stream did not end with turn.completed.')
    )
  }
  return found
}

function containmentFailures(input: CodexExecCompletionInput): CodexExecFailure[] {
  return input.descendantOutlivedRoot
    ? [
        failure(
          'descendant_outlived_root',
          'A helper process outlived the root and may still write.'
        )
      ]
    : []
}

function lastMessageFailures(lastMessage: CodexExecLastMessageCheck): CodexExecFailure[] {
  switch (lastMessage.state) {
    case 'ok':
      return []
    case 'missing':
      return [failure('last_message_missing', 'The last-message file was not written.')]
    case 'unreadable':
      return [
        failure(
          'last_message_missing',
          `The last-message file is unreadable (${lastMessage.code}).`
        )
      ]
    case 'empty':
      return [failure('last_message_empty', 'The last-message file is empty.')]
    case 'oversized':
      return [
        failure(
          'last_message_oversized',
          `The last-message file is ${lastMessage.bytes} bytes, over the limit.`
        )
      ]
  }
}

function schemaFailures(check: CodexExecSchemaCheck): CodexExecFailure[] {
  switch (check.kind) {
    case 'not_required':
    case 'passed':
      return []
    case 'failed':
      return [failure('output_schema_violation', check.detail)]
    case 'unvalidatable':
      return [failure('schema_unvalidatable', check.detail)]
  }
}

function asFailures(found: readonly CodexExecFailure[]): CodexExecFailures | null {
  const [first, ...rest] = found
  return first === undefined ? null : [first, ...rest]
}

/** Completion rule: clean exit, no surviving helper, one thread, a final turn.completed, a last message, schema met. */
export function evaluateCodexExecCompletion(input: CodexExecCompletionInput): CodexExecVerdict {
  const failures = asFailures([
    ...exitFailures(input),
    ...containmentFailures(input),
    ...streamFailures(input.stream),
    ...lastMessageFailures(input.lastMessage),
    ...schemaFailures(input.schemaCheck)
  ])
  if (failures === null) {
    return { status: 'completed' }
  }
  const block = detectCodexExecBlock([...input.stream.failureMessages, input.stderrTail])
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

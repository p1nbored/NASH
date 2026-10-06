import { compileOutputSchema } from '../../codex-exec/codex-exec-output-schema'
import { readAttemptResultFile, type AttemptResultFile } from './attempt-result-file'
import {
  failed,
  passed,
  quoted,
  undecided,
  type AttemptEvidence,
  type CheckOutcome
} from './validation-context'

// Checks on what the app's own runner observed, never on what the executor says about itself.

const EXECUTOR_COMPLETED = 'executor_completed'
const OUTPUT_SCHEMA = 'output_schema'

export function checkExecutorCompleted(evidence: AttemptEvidence): CheckOutcome {
  const { executor } = evidence
  if (!executor) {
    return undecided(EXECUTOR_COMPLETED, 'An in-session attempt has no process evidence to check.')
  }
  if (executor.state !== 'completed') {
    return failed(EXECUTOR_COMPLETED, `The executor ended in state ${quoted(executor.state)}.`)
  }
  if (executor.exitCode !== 0) {
    return failed(EXECUTOR_COMPLETED, `The executor exited with code ${String(executor.exitCode)}.`)
  }
  if (executor.verdict === null) {
    return undecided(EXECUTOR_COMPLETED, 'The runner recorded no verdict for the attempt.')
  }
  const status = executor.verdict.status
  if (status !== 'completed') {
    return failed(EXECUTOR_COMPLETED, `The runner verdict is ${quoted(String(status))}.`)
  }
  if (executor.treeVerdict === 'live') {
    return undecided(EXECUTOR_COMPLETED, 'A process of the attempt may still be running.')
  }
  if (!executor.lastMessage) {
    return undecided(EXECUTOR_COMPLETED, 'The runner recorded no result for the attempt.')
  }
  return passed(
    EXECUTOR_COMPLETED,
    'The executor exited with code 0 and the runner verdict is completed.',
    [
      { kind: 'executor_result', ref: executor.lastMessage.sha256 },
      { kind: 'attempt', ref: evidence.dispatchId }
    ]
  )
}

function resultProblem(read: Exclude<AttemptResultFile, { status: 'ok' }>): CheckOutcome {
  switch (read.status) {
    case 'missing':
    case 'empty':
    case 'not_recorded':
      return failed(OUTPUT_SCHEMA, 'The executor left no result to validate.')
    case 'changed':
      return undecided(OUTPUT_SCHEMA, 'The result changed after the runner recorded it.')
    case 'oversized':
      return undecided(OUTPUT_SCHEMA, 'The result is too large to validate.')
    case 'no_process':
    case 'no_run_directory':
    case 'unreadable':
      return undecided(OUTPUT_SCHEMA, `The result could not be read (${read.status}).`)
  }
}

/** Re-validates the Codex result against the TaskSpec's schema, independently of the runner's own check. */
export async function checkOutputSchema(
  evidence: AttemptEvidence,
  schema: Readonly<Record<string, unknown>>
): Promise<CheckOutcome> {
  if (evidence.executor?.executorKind !== 'codex_cli') {
    return undecided(OUTPUT_SCHEMA, 'The output schema check applies to Codex attempts only.')
  }
  const compiled = compileOutputSchema(schema)
  if (!compiled.ok) {
    return undecided(
      OUTPUT_SCHEMA,
      'The output schema in the TaskSpec cannot be validated locally.'
    )
  }
  const read = await readAttemptResultFile(evidence)
  if (read.status !== 'ok') {
    return resultProblem(read)
  }
  const checked = compiled.validate(read.text)
  if (checked.ok) {
    return passed(OUTPUT_SCHEMA, 'The result matches the output schema.', [
      { kind: 'executor_result', ref: read.sha256 }
    ])
  }
  return checked.kind === 'violation'
    ? failed(OUTPUT_SCHEMA, 'The result does not match the output schema.', [
        { kind: 'executor_result', ref: read.sha256 }
      ])
    : undecided(OUTPUT_SCHEMA, 'The result could not be validated against the output schema.')
}

import { join } from 'node:path'
import { AGY_OUTPUT_FILE } from '../../agy-exec/agy-exec-run-directory'
import { AGY_EXEC_OUTPUT_CEILING_BYTES } from '../../agy-exec/agy-exec-run-options'
import { readLastMessage } from '../../codex-exec/codex-exec-last-message'
import { LAST_MESSAGE_FILE } from '../../codex-exec/codex-exec-run-directory'
import type { AttemptEvidence } from './validation-context'

/** A result larger than this is not read; it is the largest answer a runner keeps (agy's, D-027). */
export const RESULT_TEXT_MAX_BYTES = AGY_EXEC_OUTPUT_CEILING_BYTES

export type AttemptResultFile =
  | {
      readonly status: 'ok'
      readonly text: string
      readonly sha256: string
      readonly bytes: number
    }
  | { readonly status: 'no_process' | 'no_run_directory' | 'not_recorded' | 'changed' }
  | { readonly status: 'missing' | 'empty' | 'oversized' | 'unreadable' }

/** The executor's result file, read by the runner's bounded reader and only while its hash matches the record. */
export async function readAttemptResultFile(evidence: AttemptEvidence): Promise<AttemptResultFile> {
  const { executor, runDirectory } = evidence
  if (!executor) {
    return { status: 'no_process' }
  }
  if (!runDirectory) {
    return { status: 'no_run_directory' }
  }
  if (!executor.lastMessage) {
    return { status: 'not_recorded' }
  }
  const fileName = executor.executorKind === 'agy_cli' ? AGY_OUTPUT_FILE : LAST_MESSAGE_FILE
  const read = await readLastMessage(join(runDirectory, fileName), RESULT_TEXT_MAX_BYTES)
  if (read.state !== 'ok') {
    return { status: read.state }
  }
  if (read.sha256 !== executor.lastMessage.sha256) {
    return { status: 'changed' }
  }
  return {
    status: 'ok',
    text: read.text,
    sha256: read.sha256,
    bytes: read.bytes
  }
}

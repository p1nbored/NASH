import { join, resolve } from 'node:path'
import { isPathInside } from '../../agent-exec-shared/path-containment'
import { redactAndBound } from '../../agent-exec-shared/secret-redaction'
import { AGY_OUTPUT_FILE } from '../../agy-exec/agy-exec-run-directory'
import { readLastMessage } from '../../codex-exec/codex-exec-last-message'
import { LAST_MESSAGE_FILE } from '../../codex-exec/codex-exec-run-directory'
import type { OrchestrationDb } from '../orchestration/db'
import { getExecutorProcessStore } from '../orchestration/db/executor-process-store'

// The only reader of an executor's own output, for task-show (D1): bounded, masked, and shown only
// while the file still matches the hash the settlement recorded. The mailbox notice never carries it.

export const ATTEMPT_RESULT_DEFAULT_MAX_CHARS = 8000

export type AttemptResultView =
  | {
      readonly state: 'ok'
      /** Masked and bounded; never the raw file. */
      readonly text: string
      readonly truncated: boolean
      readonly secretLike: boolean
      readonly bytes: number
      readonly sha256: string
    }
  | {
      readonly state:
        | 'no_result'
        | 'missing'
        | 'empty'
        | 'unreadable'
        | 'changed'
        | 'outside_data_folder'
    }

export type AttemptResultDeps = {
  readonly owner: OrchestrationDb
  /** The app's data folder; run directories are recorded relative to it. */
  readonly userDataPath: string
  readonly maxChars?: number
}

export async function readAttemptResult(
  deps: AttemptResultDeps,
  dispatchId: string
): Promise<AttemptResultView> {
  const record = getExecutorProcessStore(deps.owner).get(dispatchId)
  const recorded = record?.lastMessage
  if (!record || !recorded) {
    return { state: 'no_result' }
  }
  const runDir = resolve(deps.userDataPath, record.runDirectory)
  if (!isPathInside(runDir, deps.userDataPath, process.platform)) {
    return { state: 'outside_data_folder' }
  }
  const file = join(runDir, record.executorKind === 'agy_cli' ? AGY_OUTPUT_FILE : LAST_MESSAGE_FILE)
  // Why: the recorded size bounds the read, so a file that grew afterwards reads as changed.
  const check = await readLastMessage(file, Math.max(recorded.bytes, 1))
  switch (check.state) {
    case 'ok': {
      if (check.sha256 !== recorded.sha256) {
        return { state: 'changed' }
      }
      const shown = redactAndBound(check.text, deps.maxChars ?? ATTEMPT_RESULT_DEFAULT_MAX_CHARS)
      return {
        state: 'ok',
        text: shown.text,
        truncated: shown.truncated,
        secretLike: check.secretLike,
        bytes: check.bytes,
        sha256: check.sha256
      }
    }
    case 'oversized':
      return { state: 'changed' }
    case 'missing':
    case 'empty':
    case 'unreadable':
      return { state: check.state }
  }
}

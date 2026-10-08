import { createHash } from 'node:crypto'
import { isNativeTaskAttempt } from '../workflow-run/app-run-policy'
import { redactAndBound, containsSecretLikeText } from '../../agent-exec-shared/secret-redaction'
import type { OrchestrationDb } from '../orchestration/db'

export const ATTEMPT_RESULT_DEFAULT_MAX_CHARS = 8000

export type AttemptResultView =
  | {
      readonly state: 'ok'
      readonly text: string
      readonly truncated: boolean
      readonly secretLike: boolean
      readonly bytes: number
      readonly sha256: string
    }
  | { readonly state: 'no_result' }

export type AttemptResultDeps = {
  readonly owner: OrchestrationDb
  readonly maxChars?: number
}

/** The latest native worker report; superseded attempts never expose a newer attempt's report. */
export async function readAttemptResult(
  deps: AttemptResultDeps,
  dispatchId: string
): Promise<AttemptResultView> {
  if (!isNativeTaskAttempt(deps.owner, dispatchId)) {
    return { state: 'no_result' }
  }
  const dispatch = deps.owner.getDispatchContextById(dispatchId)
  const task = dispatch ? deps.owner.getTask(dispatch.task_id) : undefined
  const text = task?.result
  if (!text || deps.owner.getDispatchContext(task.id)?.id !== dispatchId) {
    return { state: 'no_result' }
  }
  const shown = redactAndBound(text, deps.maxChars ?? ATTEMPT_RESULT_DEFAULT_MAX_CHARS)
  return {
    state: 'ok',
    ...shown,
    secretLike: containsSecretLikeText(text),
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex')
  }
}

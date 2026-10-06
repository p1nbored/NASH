import type {
  WorkbenchAttemptTranscriptReadInput,
  WorkbenchAttemptTranscriptReadResult
} from '../../../shared/rpc-contract/workbench-task-window-params'
import { readLocalLogTailRange } from '../../ai-vault/local-log-tail-reader'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import {
  getExecutorProcessStore,
  type ExecutorProcessRecord
} from '../orchestration/db/executor-process-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  locateAttemptTranscript,
  transcriptIdentityDigest,
  type AttemptTranscriptRoots
} from './attempt-transcript-file'
import { readTranscriptTail, wholeLinePrefixLength } from './attempt-transcript-lines'

export type AttemptTranscriptReadDeps = AttemptTranscriptRoots & {
  readonly owner: OrchestrationDb
}

/** A live attempt is one the executor still runs; an orphan Orca no longer holds is not. */
export function isAttemptLive(record: ExecutorProcessRecord): boolean {
  return (record.state === 'starting' || record.state === 'running') && !record.orphaned
}

function waitingForTranscript(): WorkbenchAttemptTranscriptReadResult {
  return {
    chunk: '',
    nextByteOffset: 0,
    fileIdentity: '',
    reset: false,
    truncated: false,
    live: true,
    ended: false
  }
}

/**
 * D-024: one ranged read of a Codex or agy attempt's transcript. The file comes from the attempt's
 * recorded run directory only; the reader logic is the AI Vault live-tail reader's.
 */
export async function readAttemptTranscript(
  deps: AttemptTranscriptReadDeps,
  params: WorkbenchAttemptTranscriptReadInput
): Promise<WorkbenchAttemptTranscriptReadResult> {
  const record = getExecutorProcessStore(deps.owner).get(params.dispatchId)
  if (!record) {
    throw new OrchestrationError('workbench_attempt_not_found', 'The attempt was not found.')
  }
  const live = isAttemptLive(record)
  const location = await locateAttemptTranscript(deps, record.runDirectory)
  if (location.kind === 'refused') {
    throw new OrchestrationError(
      'workbench_transcript_refused',
      'The transcript could not be confirmed as this attempt’s own file in the runs folder, so it was not read.'
    )
  }
  if (location.kind === 'missing') {
    if (live) {
      return waitingForTranscript()
    }
    throw new OrchestrationError(
      'workbench_transcript_missing',
      'No transcript was recorded for this attempt.'
    )
  }
  const range = await readLocalLogTailRange(location.path, params.fromByteOffset)
  const tail = await readTranscriptTail(location.path)
  const fileIdentity = transcriptIdentityDigest(range.fileIdentity)
  if (range.reset) {
    return {
      chunk: '',
      nextByteOffset: 0,
      fileIdentity,
      reset: true,
      truncated: tail.truncated,
      live,
      ended: false
    }
  }
  const bytes = Buffer.from(range.contentBase64, 'base64').subarray(0, params.maxBytes)
  const reachesEnd = params.fromByteOffset + bytes.length >= range.fileSize
  const taken = wholeLinePrefixLength(bytes, {
    fullWindow: bytes.length === params.maxBytes,
    flushAtEnd: reachesEnd && !live
  })
  const nextByteOffset = params.fromByteOffset + taken
  return {
    chunk: bytes.subarray(0, taken).toString('utf8'),
    nextByteOffset,
    fileIdentity,
    reset: false,
    truncated: tail.truncated,
    live,
    ended: tail.lastKind === 'end' && nextByteOffset >= tail.size
  }
}

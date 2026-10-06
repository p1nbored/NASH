import {
  ATTEMPT_TRANSCRIPT_READ_MAX_BYTES,
  type WorkbenchAttemptTranscriptReadResult
} from '../../../../shared/rpc-contract/workbench-task-window-params'
import { parseTranscriptLine } from './task-window-records'
import {
  EMPTY_TRANSCRIPT_ROW_LOG,
  appendTranscriptRecords,
  type TranscriptRowLog
} from './task-window-row-log'

export const TRANSCRIPT_READ_BYTES = ATTEMPT_TRANSCRIPT_READ_MAX_BYTES
/** Design section 1.2: one read a second while the attempt is live. */
export const TRANSCRIPT_POLL_MS = 1_000
export const TRANSCRIPT_RETRY_MS = 5_000
/** Reads after the attempt settles, for an end record the writer may still be flushing. */
export const TRANSCRIPT_SETTLE_GRACE_READS = 3
// Why a margin: the host returns whole lines, so a full window can end up to one record short.
const FULL_WINDOW_MARGIN = 16 * 1024
const FINAL_ERROR_CODES: ReadonlySet<string> = new Set([
  'workbench_transcript_refused',
  'workbench_attempt_not_found',
  'workbench_forbidden',
  'method_not_found'
])

export type TranscriptError = { readonly code: string; readonly message: string }

export type TranscriptReadState = {
  readonly dispatchId: string
  /** Appended per read without copying earlier rows (a run can write thousands of records). */
  readonly rows: TranscriptRowLog
  readonly nextByteOffset: number
  readonly fileIdentity: string
  /** The start of a line whose end has not been read yet. */
  readonly carry: string
  readonly nextLine: number
  readonly live: boolean
  readonly ended: boolean
  readonly truncated: boolean
  readonly loaded: boolean
  readonly missing: boolean
  /** The file was replaced or shrank, so the next read starts over. */
  readonly restart: boolean
  readonly error: TranscriptError | null
}

export function initialTranscriptState(dispatchId: string): TranscriptReadState {
  return {
    dispatchId,
    rows: EMPTY_TRANSCRIPT_ROW_LOG,
    nextByteOffset: 0,
    fileIdentity: '',
    carry: '',
    nextLine: 0,
    live: true,
    ended: false,
    truncated: false,
    loaded: false,
    missing: false,
    restart: false,
    error: null
  }
}

export function applyTranscriptRead(
  state: TranscriptReadState,
  result: WorkbenchAttemptTranscriptReadResult,
  fromByteOffset: number
): TranscriptReadState {
  const replaced =
    state.fileIdentity !== '' &&
    result.fileIdentity !== '' &&
    result.fileIdentity !== state.fileIdentity
  if (result.reset || replaced) {
    return {
      ...initialTranscriptState(state.dispatchId),
      fileIdentity: result.fileIdentity,
      live: result.live,
      truncated: result.truncated,
      loaded: true,
      restart: true
    }
  }
  const parts = (state.carry + result.chunk).split('\n')
  const consumed = result.nextByteOffset - fromByteOffset
  const readToEnd = !result.live && consumed < TRANSCRIPT_READ_BYTES - FULL_WINDOW_MARGIN
  // Why: a settled attempt's last line will never be finished, so it is shown as it is.
  const carry = readToEnd ? '' : (parts.pop() ?? '')
  const records = parts
    .map((part) => part.replace(/\r$/, ''))
    .filter((part) => part.trim() !== '')
    .map((part, index) => parseTranscriptLine(part, state.nextLine + index))
  return {
    ...state,
    rows: appendTranscriptRecords(state.rows, records),
    nextLine: state.nextLine + records.length,
    carry,
    nextByteOffset: result.nextByteOffset,
    fileIdentity: result.fileIdentity || state.fileIdentity,
    live: result.live,
    ended: result.ended,
    truncated: result.truncated,
    loaded: true,
    missing: false,
    restart: false,
    error: null
  }
}

export function withTranscriptError(
  state: TranscriptReadState,
  error: TranscriptError
): TranscriptReadState {
  if (error.code === 'workbench_transcript_missing') {
    return { ...state, missing: true, live: false, loaded: true, error: null }
  }
  return { ...state, loaded: true, error }
}

/** Milliseconds until the next read, or null to stop reading this attempt. */
export function planNextTranscriptRead(
  state: TranscriptReadState,
  last: { readonly consumed: number; readonly graceLeft: number }
): number | null {
  if (state.missing) {
    return null
  }
  if (state.error) {
    return FINAL_ERROR_CODES.has(state.error.code) ? null : TRANSCRIPT_RETRY_MS
  }
  if (state.ended) {
    return null
  }
  if (state.restart || last.consumed >= TRANSCRIPT_READ_BYTES - FULL_WINDOW_MARGIN) {
    return 0
  }
  if (state.live) {
    return TRANSCRIPT_POLL_MS
  }
  return last.graceLeft > 0 ? TRANSCRIPT_POLL_MS : null
}

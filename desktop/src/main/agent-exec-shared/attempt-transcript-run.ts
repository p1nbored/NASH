import {
  openAttemptTranscript,
  type AttemptTranscript,
  type AttemptTranscriptInput,
  type AttemptTranscriptOption,
  type AttemptTranscriptOutcome
} from './attempt-transcript'
import { transcriptEndOf, type TranscriptVerdict } from './attempt-transcript-records'

// How a runner opens the transcript its caller asked for and closes it on the run's result.

/** Opened when the child is about to start, after the run directory exists; null when none was asked for. */
export function openRunTranscript(
  option: AttemptTranscriptOption | undefined,
  input: Omit<AttemptTranscriptInput, 'path'>
): AttemptTranscript | null {
  return option === undefined ? null : openAttemptTranscript({ ...input, path: option.path })
}

type TranscribedResult = {
  readonly verdict: TranscriptVerdict
  readonly exitCode: number | null
  readonly transcript: AttemptTranscriptOutcome | null
}

/** Writes `end` from the settled result and records the outcome on it; it never rejects. */
export async function settleRunTranscript<R extends TranscribedResult>(
  transcript: AttemptTranscript | null,
  result: R
): Promise<R> {
  if (transcript === null) {
    return result
  }
  const outcome = await transcript.finish(transcriptEndOf(result.verdict, result.exitCode))
  return { ...result, transcript: outcome }
}

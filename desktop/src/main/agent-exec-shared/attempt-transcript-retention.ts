import { lstat, open, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ATTEMPT_TRANSCRIPT_FILE, TRANSCRIPT_FORMAT_VERSION } from './attempt-transcript-records'

// Deletes the transcripts of attempts settled long ago, under `<runs root>/<run>/<attempt>/`; nothing else.

export const TRANSCRIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_TRANSCRIPT_DELETIONS_PER_PASS = 50
/** Every transcript opens with its start record, so a file without this head was not written by NASH. */
const TRANSCRIPT_HEAD = `{"v":${TRANSCRIPT_FORMAT_VERSION},"seq":0,"at":"`
const START_KIND = '"kind":"start"'
const HEAD_BYTES = 96

export type TranscriptRetentionResult = { readonly deleted: number; readonly errors: number }

export type TranscriptRetentionInput = {
  /** `<userData>/autopilot-runs`. */
  readonly root: string
  readonly nowMs: number
  readonly maxAgeMs?: number
  readonly maxDeletions?: number
  /** Test seam for a deletion that fails. */
  readonly unlink?: (path: string) => Promise<void>
}

type CountError = () => void

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Real child directories only: a link is never a directory entry here, so it is never followed. */
async function directoriesIn(path: string, countError: CountError): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(path, entry.name))
  } catch (error) {
    if (!isMissing(error)) {
      countError()
    }
    return []
  }
}

async function* attemptTranscripts(root: string, countError: CountError): AsyncGenerator<string> {
  for (const run of await directoriesIn(root, countError)) {
    for (const attempt of await directoriesIn(run, countError)) {
      yield join(attempt, ATTEMPT_TRANSCRIPT_FILE)
    }
  }
}

async function startsLikeTranscript(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0)
    const head = buffer.subarray(0, bytesRead).toString('utf8')
    return head.startsWith(TRANSCRIPT_HEAD) && head.includes(START_KIND)
  } finally {
    await handle.close()
  }
}

/**
 * A transcript's last write is its `end` record, so its mtime is when the attempt settled; a run
 * timer is capped below 30 days, so a transcript untouched that long belongs to no running attempt.
 */
async function isExpired(path: string, cutoffMs: number, countError: CountError): Promise<boolean> {
  try {
    const status = await lstat(path)
    return status.isFile() && status.mtimeMs < cutoffMs && (await startsLikeTranscript(path))
  } catch (error) {
    if (!isMissing(error)) {
      countError()
    }
    return false
  }
}

/** One pass: deletes at most `maxDeletions` expired transcripts and counts failures; it never throws. */
export async function pruneSettledTranscripts(
  input: TranscriptRetentionInput
): Promise<TranscriptRetentionResult> {
  const maxDeletions = input.maxDeletions ?? MAX_TRANSCRIPT_DELETIONS_PER_PASS
  const cutoffMs = input.nowMs - (input.maxAgeMs ?? TRANSCRIPT_RETENTION_MS)
  const remove = input.unlink ?? unlink
  let deleted = 0
  let errors = 0
  const countError: CountError = () => {
    errors += 1
  }
  for await (const path of attemptTranscripts(input.root, countError)) {
    if (deleted >= maxDeletions) {
      break
    }
    if (!(await isExpired(path, cutoffMs, countError))) {
      continue
    }
    try {
      await remove(path)
      deleted += 1
    } catch {
      countError()
    }
  }
  return { deleted, errors }
}

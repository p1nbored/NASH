import { createHash } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ATTEMPT_TRANSCRIPT_FILE } from '../../agent-exec-shared/attempt-transcript'
import { isPathInside } from '../../agent-exec-shared/path-containment'
import { ATTEMPT_RUNS_FOLDER } from '../task-execution/task-execution-runtime'

// Why a head check: the run directory also holds the CLI's temp folder, so only a file that starts
// like the writer's first record is handed to the renderer.
const TRANSCRIPT_HEAD = Buffer.from('{"v":1,"seq":0,"at":"')

export type AttemptTranscriptLocation =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'refused' }

export type AttemptTranscriptRoots = {
  /** The app's data folder; run directories are recorded relative to it. */
  readonly userDataPath: string
  readonly platform?: NodeJS.Platform
}

const REFUSED: AttemptTranscriptLocation = { kind: 'refused' }
const MISSING: AttemptTranscriptLocation = { kind: 'missing' }

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function startsLikeTranscript(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(TRANSCRIPT_HEAD.length)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    return head.subarray(0, bytesRead).equals(TRANSCRIPT_HEAD.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

/**
 * The transcript of a recorded run directory, strictly below `<userData>/autopilot-runs`. Links are
 * never followed: the run directory and the file must not be links, and the real path is checked too.
 */
export async function locateAttemptTranscript(
  roots: AttemptTranscriptRoots,
  runDirectory: string
): Promise<AttemptTranscriptLocation> {
  const platform = roots.platform ?? process.platform
  const runsRoot = resolve(roots.userDataPath, ATTEMPT_RUNS_FOLDER)
  const runDir = resolve(roots.userDataPath, runDirectory)
  if (!isPathInside(runDir, runsRoot, platform) || isPathInside(runsRoot, runDir, platform)) {
    return REFUSED
  }
  const file = join(runDir, ATTEMPT_TRANSCRIPT_FILE)
  try {
    if ((await lstat(runDir)).isSymbolicLink()) {
      return REFUSED
    }
    const stats = await lstat(file)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return REFUSED
    }
    const [realRoot, realFile] = await Promise.all([realpath(runsRoot), realpath(file)])
    if (!isPathInside(realFile, realRoot, platform) || isPathInside(realRoot, realFile, platform)) {
      return REFUSED
    }
    return (await startsLikeTranscript(realFile)) ? { kind: 'file', path: realFile } : REFUSED
  } catch (error) {
    return isMissing(error) ? MISSING : REFUSED
  }
}

/** Device and inode numbers stay in main; the renderer only compares the digest. */
export function transcriptIdentityDigest(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

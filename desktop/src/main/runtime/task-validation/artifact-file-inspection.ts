import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { isLocalAbsolutePath, isPathInside } from '../../agent-exec-shared/path-containment'
import { isPlainRelativePath } from '../orchestration/db/autopilot-relative-path'

// An artifact is a plain relative path with no link on it, inside its root, read through the checked handle.

const DEFAULT_MAX_HASH_BYTES = 256 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024
/** O_NOFOLLOW does not exist on Windows; there the per-segment lstat walk is the link guard. */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)

export type ArtifactFileResult =
  | {
      readonly status: 'ok'
      readonly sha256: string
      readonly sizeBytes: number
      /** The UTF-8 text, only when asked for and within the text bound. */
      readonly text: string | null
    }
  | {
      readonly status:
        | 'path_refused'
        | 'missing'
        | 'symlink'
        | 'hard_linked'
        | 'escape'
        | 'not_a_file'
    }
  | { readonly status: 'too_large'; readonly sizeBytes: number }
  | { readonly status: 'changed' }
  | { readonly status: 'unreadable'; readonly code: string }

export type ArtifactInspectionOptions = {
  readonly maxHashBytes?: number
  readonly textMaxBytes?: number
  readonly platform?: NodeJS.Platform
  readonly deps?: { readonly realPath?: (path: string) => Promise<string> }
}

type Walk =
  | { readonly path: string; readonly stats: BigIntStats }
  | { readonly failure: ArtifactFileResult }

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'
}

function missingOrUnreadable(error: unknown): ArtifactFileResult {
  const code = errorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
    ? { status: 'missing' }
    : { status: 'unreadable', code }
}

/** lstat every segment below the root, so a link anywhere on the path is refused, not followed. */
async function walkSegments(root: string, relativePath: string): Promise<Walk> {
  const segments = relativePath.split('/')
  let current = root
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment)
    let stats: BigIntStats
    try {
      // Why bigint: NTFS file ids exceed 2^53, and the identity check below compares them exactly.
      stats = await lstat(current, { bigint: true })
    } catch (error) {
      return { failure: missingOrUnreadable(error) }
    }
    if (stats.isSymbolicLink()) {
      return { failure: { status: 'symlink' } }
    }
    const last = index === segments.length - 1
    if (!last && !stats.isDirectory()) {
      return { failure: { status: 'missing' } }
    }
    if (last) {
      return fileAtEnd(current, stats)
    }
  }
  return { failure: { status: 'path_refused' } }
}

/** A second hard link can name a file outside the root, which no path check would see. */
function fileAtEnd(path: string, stats: BigIntStats): Walk {
  if (!stats.isFile()) {
    return { failure: { status: 'not_a_file' } }
  }
  return stats.nlink > 1n ? { failure: { status: 'hard_linked' } } : { path, stats }
}

async function staysInsideRoot(
  root: string,
  path: string,
  options: ArtifactInspectionOptions
): Promise<boolean> {
  const resolve = options.deps?.realPath ?? ((target: string) => realpath(target))
  const [realRoot, realTarget] = await Promise.all([resolve(root), resolve(path)])
  return isPathInside(realTarget, realRoot, options.platform ?? process.platform)
}

async function digest(
  handle: FileHandle,
  sizeBytes: number,
  textMaxBytes: number | undefined
): Promise<ArtifactFileResult> {
  const hash = createHash('sha256')
  const keepText = textMaxBytes !== undefined && sizeBytes <= textMaxBytes
  const kept: Buffer[] = []
  let total = 0
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES)
  for (;;) {
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
    if (bytesRead === 0) {
      break
    }
    total += bytesRead
    if (total > sizeBytes) {
      return { status: 'changed' }
    }
    hash.update(chunk.subarray(0, bytesRead))
    if (keepText) {
      kept.push(Buffer.from(chunk.subarray(0, bytesRead)))
    }
  }
  if (total !== sizeBytes) {
    return { status: 'changed' }
  }
  const text = keepText ? Buffer.concat(kept, total).toString('utf8') : null
  return { status: 'ok', sha256: hash.digest('hex'), sizeBytes, text }
}

async function hashThroughHandle(
  path: string,
  checked: BigIntStats,
  options: ArtifactInspectionOptions
): Promise<ArtifactFileResult> {
  const handle = await open(path, OPEN_FLAGS)
  try {
    const opened = await handle.stat({ bigint: true })
    // Why: an id of 0 proves nothing, so the file cannot be shown to be the one that was checked.
    const sameFile = checked.ino !== 0n && checked.ino === opened.ino && checked.dev === opened.dev
    if (!opened.isFile() || !sameFile) {
      return { status: 'changed' }
    }
    const maxHashBytes = options.maxHashBytes ?? DEFAULT_MAX_HASH_BYTES
    const sizeBytes = Number(opened.size)
    if (sizeBytes > maxHashBytes) {
      return { status: 'too_large', sizeBytes }
    }
    return await digest(handle, sizeBytes, options.textMaxBytes)
  } finally {
    await handle.close()
  }
}

/** What an artifact path under a root holds now, refusing escapes and links instead of following them. */
export async function inspectArtifactFile(
  root: string,
  relativePath: string,
  options: ArtifactInspectionOptions = {}
): Promise<ArtifactFileResult> {
  if (!isPlainRelativePath(relativePath) || relativePath.length === 0) {
    return { status: 'path_refused' }
  }
  if (!isLocalAbsolutePath(root, options.platform ?? process.platform)) {
    return { status: 'unreadable', code: 'ROOT_NOT_ABSOLUTE' }
  }
  try {
    const walked = await walkSegments(root, relativePath)
    if ('failure' in walked) {
      return walked.failure
    }
    if (!(await staysInsideRoot(root, walked.path, options))) {
      return { status: 'escape' }
    }
    return await hashThroughHandle(walked.path, walked.stats, options)
  } catch (error) {
    return missingOrUnreadable(error)
  }
}

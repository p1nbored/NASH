import { realpath } from 'node:fs'
import { lstat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isLocalAbsolutePath, isPathInside, pathApiFor } from './path-containment'

// A run directory is built here from a runs root and id, exclusive and private, so it cannot be shared or pre-planted.

export const RUN_TEMP_DIRECTORY = 'tmp'
const PRIVATE_DIRECTORY_MODE = 0o700
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

const nativeRealpath = promisify(realpath.native)

/** The directory a run owns and the private temp directory inside it; runners add their own file names. */
export type RunDirectoryLocation = {
  readonly runDir: string
  readonly tempDir: string
}

export type RunDirectoryInput = {
  readonly runsRoot: unknown
  readonly runId: unknown
  readonly worktreePath: string
  readonly platform: NodeJS.Platform
  /** Directories the runs root must not be, or lie under; the OS temp locations by default. */
  readonly forbiddenRoots: readonly string[]
}

export type RunDirectoryLocationResult =
  | { readonly ok: true; readonly value: RunDirectoryLocation }
  | { readonly ok: false; readonly detail: string }

export type RunDirectoryResult =
  | { readonly ok: true; readonly value: RunDirectoryLocation }
  | {
      readonly ok: false
      readonly kind: 'invalid_request' | 'run_dir_unusable'
      readonly detail: string
    }

/** Where the OS lets a sandboxed process write; a run directory there could be planted with links. */
export function defaultTempRoots(platform: NodeJS.Platform): readonly string[] {
  const env = process.env
  const candidates =
    platform === 'win32'
      ? [
          tmpdir(),
          env.TEMP,
          env.TMP,
          env.SystemRoot === undefined ? undefined : join(env.SystemRoot, 'Temp')
        ]
      : [tmpdir(), env.TMPDIR, '/tmp', '/var/tmp']
  return candidates.filter((root): root is string => typeof root === 'string' && root !== '')
}

/** Pure checks on the runs root and run id, and the paths they imply; nothing touches the disk. */
export function locateRunDirectory(
  value: { readonly runsRoot: unknown; readonly runId: unknown },
  platform: NodeJS.Platform
): RunDirectoryLocationResult {
  const { runsRoot, runId } = value
  if (!isLocalAbsolutePath(runsRoot, platform)) {
    return { ok: false, detail: 'The runs root must be an absolute local path.' }
  }
  if (
    typeof runId !== 'string' ||
    !RUN_ID_PATTERN.test(runId) ||
    WINDOWS_RESERVED_NAME.test(runId)
  ) {
    return {
      ok: false,
      detail: 'The run id must be 1 to 64 letters, digits, underscores or dashes.'
    }
  }
  const api = pathApiFor(platform)
  const runDir = api.join(runsRoot, runId)
  return { ok: true, value: { runDir, tempDir: api.join(runDir, RUN_TEMP_DIRECTORY) } }
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'
}

async function canonical(path: string): Promise<string> {
  try {
    return await nativeRealpath(path)
  } catch {
    return path
  }
}

const unusable = (detail: string): RunDirectoryResult => ({
  ok: false,
  kind: 'run_dir_unusable',
  detail
})

/** The runs root must be a real directory, not a link, and nowhere a sandboxed process can plant files. */
async function rootProblem(input: RunDirectoryInput, runsRoot: string): Promise<string | null> {
  const status = await lstat(runsRoot)
  if (status.isSymbolicLink() || !status.isDirectory()) {
    return 'The runs root must be a real directory, not a link.'
  }
  const realRoot = await canonical(runsRoot)
  const fenced = [input.worktreePath, ...input.forbiddenRoots]
  for (const fence of fenced) {
    if (isPathInside(realRoot, await canonical(fence), input.platform)) {
      return 'The runs root must not be the worktree or lie under it or under a temp directory.'
    }
  }
  return null
}

async function confirmOwnership(runDir: string): Promise<string | null> {
  const status = await lstat(runDir)
  if (status.isSymbolicLink() || !status.isDirectory()) {
    return 'The new run directory is not a plain directory.'
  }
  const owner = typeof process.getuid === 'function' ? process.getuid() : null
  return owner !== null && status.uid !== owner
    ? 'The new run directory is owned by another user.'
    : null
}

export async function createRunDirectory(input: RunDirectoryInput): Promise<RunDirectoryResult> {
  const located = locateRunDirectory(input, input.platform)
  if (!located.ok || typeof input.runsRoot !== 'string') {
    return {
      ok: false,
      kind: 'invalid_request',
      detail: located.ok ? 'Invalid runs root.' : located.detail
    }
  }
  const { runDir, tempDir } = located.value
  try {
    const problem = await rootProblem(input, input.runsRoot)
    if (problem !== null) {
      return unusable(problem)
    }
    // Non-recursive and exclusive: an existing directory or link at this name fails instead of being reused.
    await mkdir(runDir, { mode: PRIVATE_DIRECTORY_MODE })
    const owned = await confirmOwnership(runDir)
    if (owned !== null) {
      return unusable(owned)
    }
    await mkdir(tempDir, { mode: PRIVATE_DIRECTORY_MODE })
  } catch (error) {
    return unusable(`The run directory could not be created (${errorCode(error)}).`)
  }
  return { ok: true, value: located.value }
}

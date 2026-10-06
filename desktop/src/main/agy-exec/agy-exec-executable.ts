import { realpathSync, statSync } from 'node:fs'
import { readEnvironmentVariable, sanitizePathList } from '../agent-exec-shared/exec-environment'
import type { LaunchTarget } from '../agent-exec-shared/launch-target'
import { isLocalAbsolutePath, pathApiFor } from '../agent-exec-shared/path-containment'
import { powerShellScriptTarget } from '../agent-exec-shared/powershell-script-launch'

// Resolves agy the way a shell would: the native .exe first, else the installed .cmd/.bat launcher,
// else a .ps1 launcher run by PowerShell (D-023 amendment).

export type AgyExecutableSelection = {
  /** An explicit absolute path; when absent, PATH is searched. */
  readonly agyPath?: string
}

export type AgyExecutable = LaunchTarget & {
  readonly source: 'explicit' | 'path-search'
  readonly launch: 'direct' | 'powershell-script'
}

export type AgyExecutableDeps = {
  readonly isFile: (path: string) => boolean
  readonly realPath: (path: string) => string
}

export type AgyExecutableOptions = {
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly deps?: Partial<AgyExecutableDeps>
  /** Subtrees dropped from the PATH searched, so a repository cannot supply the binary. */
  readonly excludePathUnder?: readonly string[]
}

export type AgyExecutableErrorCode = 'not_found' | 'invalid_selection'

export class AgyExecutableError extends Error {
  readonly code: AgyExecutableErrorCode

  constructor(code: AgyExecutableErrorCode, message: string) {
    super(message)
    this.name = 'AgyExecutableError'
    this.code = code
  }
}

const DEFAULT_DEPS: AgyExecutableDeps = {
  isFile: (path) => {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  realPath: (path) => {
    try {
      return realpathSync.native(path)
    } catch {
      return path
    }
  }
}

/** Candidate file names per directory, in the order a shell would try them. */
const WIN32_CANDIDATES = ['agy.exe', 'agy.cmd', 'agy.bat', 'agy.ps1'] as const
const POSIX_CANDIDATES = ['agy'] as const
const WIN32_DIRECT_EXTENSIONS = ['.exe', '.cmd', '.bat']

function assertLaunchable(path: unknown, platform: NodeJS.Platform): asserts path is string {
  if (!isLocalAbsolutePath(path, platform)) {
    throw new AgyExecutableError(
      'invalid_selection',
      'The agy path must be an absolute local path.'
    )
  }
  const extension = pathApiFor(platform).extname(path).toLowerCase()
  if (
    platform === 'win32' &&
    !WIN32_DIRECT_EXTENSIONS.includes(extension) &&
    extension !== '.ps1'
  ) {
    throw new AgyExecutableError(
      'invalid_selection',
      'agy must be an .exe, .cmd, .bat or .ps1 launcher on Windows.'
    )
  }
}

function sanitizedPath(options: AgyExecutableOptions, platform: NodeJS.Platform): string {
  return sanitizePathList(readEnvironmentVariable(options.env ?? process.env, 'PATH', platform), {
    platform,
    excludePathUnder: options.excludePathUnder
  })
}

function findOnPath(
  pathValue: string,
  platform: NodeJS.Platform,
  deps: AgyExecutableDeps
): string | null {
  const api = pathApiFor(platform)
  const names = platform === 'win32' ? WIN32_CANDIDATES : POSIX_CANDIDATES
  for (const directory of pathValue.split(api.delimiter)) {
    if (directory === '') {
      continue
    }
    for (const name of names) {
      const candidate = api.join(directory, name)
      if (deps.isFile(candidate)) {
        return candidate
      }
    }
  }
  return null
}

export function resolveAgyExecutable(
  selection: AgyExecutableSelection,
  options: AgyExecutableOptions = {}
): AgyExecutable {
  const platform = options.platform ?? process.platform
  const deps = { ...DEFAULT_DEPS, ...options.deps }
  const explicit = selection.agyPath !== undefined
  const pathValue = sanitizedPath(options, platform)
  const found = explicit ? selection.agyPath : findOnPath(pathValue, platform, deps)
  if (found === null || found === undefined) {
    throw new AgyExecutableError('not_found', 'No agy executable was found on PATH.')
  }
  assertLaunchable(found, platform)
  if (!deps.isFile(found)) {
    throw new AgyExecutableError('not_found', 'The agy path does not exist.')
  }
  const source = explicit ? 'explicit' : 'path-search'
  if (platform === 'win32' && pathApiFor(platform).extname(found).toLowerCase() === '.ps1') {
    const target = powerShellScriptTarget(found, options.env ?? process.env, pathValue, deps.isFile)
    return {
      ...target,
      entryPath: found,
      requestedPath: found,
      launch: 'powershell-script',
      source,
      electronRunAsNode: false
    }
  }
  return {
    program: found,
    prefixArgs: [],
    entryPath: deps.realPath(found),
    requestedPath: found,
    launch: 'direct',
    source,
    electronRunAsNode: false
  }
}

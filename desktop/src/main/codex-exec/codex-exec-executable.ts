import { realpathSync, statSync } from 'node:fs'
import {
  resolveWindowsCmdShim,
  type WindowsCmdShimResolution
} from '../../shared/child-process/windows-cmd-shim-resolution'
import { readEnvironmentVariable, sanitizePathList } from './codex-exec-environment'
import { isLocalAbsolutePath, pathApiFor } from '../agent-exec-shared/path-containment'
import { powerShellScriptTarget } from '../agent-exec-shared/powershell-script-launch'

// Resolves codex the way a shell would: a recognised npm shim runs its node entry, any other
// launcher (.cmd, .bat, .ps1) starts as installed (D-023 amendment).

export type CodexExecutableSelection =
  | { readonly kind: 'installed'; readonly codexPath?: string }
  | {
      readonly kind: 'node-entry'
      readonly entryPath: string
      readonly nodePath?: string
    }

export type CodexExecutable = {
  /** Program handed to the process pipeline. */
  readonly program: string
  /** Arguments placed before the codex arguments (the node entry script, when there is one). */
  readonly prefixArgs: readonly string[]
  /** The script or binary actually launched. */
  readonly entryPath: string
  /** The path as selected or discovered, before any shim resolution. */
  readonly requestedPath: string
  readonly launch: 'direct' | 'node-entry' | 'powershell-script'
  readonly source: 'explicit' | 'path-search' | 'node-entry'
  /** The program is the Electron binary, which behaves as Node only with ELECTRON_RUN_AS_NODE=1. */
  readonly electronRunAsNode: boolean
}

export type CodexExecutableDeps = {
  readonly isFile: (path: string) => boolean
  readonly realPath: (path: string) => string
  readonly resolveShim: (program: string, env: NodeJS.ProcessEnv) => WindowsCmdShimResolution | null
}

export type CodexExecutableOptions = {
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly deps?: Partial<CodexExecutableDeps>
  /** Whether this process is Electron, where process.execPath is the app and not Node. */
  readonly isElectron?: boolean
  readonly execPath?: string
  /** Subtrees dropped from the PATH searched, so a repository cannot supply the binary. */
  readonly excludePathUnder?: readonly string[]
}

export type CodexExecutableErrorCode = 'not_found' | 'invalid_selection'

export class CodexExecutableError extends Error {
  readonly code: CodexExecutableErrorCode

  constructor(code: CodexExecutableErrorCode, message: string) {
    super(message)
    this.name = 'CodexExecutableError'
    this.code = code
  }
}

const DEFAULT_DEPS: CodexExecutableDeps = {
  isFile: (path) => {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  realPath: (path) => {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  },
  resolveShim: resolveWindowsCmdShim
}

/** Candidate file names per directory, in the order a shell would try them. */
const WIN32_CANDIDATES = ['codex.exe', 'codex.cmd', 'codex.bat', 'codex.ps1'] as const
const POSIX_CANDIDATES = ['codex'] as const
const NODE_ENTRY_EXTENSIONS = ['.js', '.mjs', '.cjs']
/** Extensions that reach cmd.exe or a DOS command interpreter. */
const SHELL_EXTENSIONS = ['.cmd', '.bat', '.com']
/** The packaged desktop app ships its own codex.exe, which must never be used here. */
const DESKTOP_APP_DIRECTORY = /[\\/]WindowsApps[\\/]/i

type Context = {
  readonly env: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  readonly deps: CodexExecutableDeps
  readonly isElectron: boolean
  readonly execPath: string
}

type NodeHost = { readonly program: string; readonly electronRunAsNode: boolean }

/** The environment with PATH replaced by its sanitized form, whatever case the key was spelled in. */
function withSanitizedPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  excludePathUnder: readonly string[]
): NodeJS.ProcessEnv {
  const isPathKey = (key: string): boolean =>
    platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH'
  const kept = Object.entries(env).filter(([key]) => !isPathKey(key))
  const path = sanitizePathList(readEnvironmentVariable(env, 'PATH', platform), {
    platform,
    excludePathUnder
  })
  return { ...Object.fromEntries(kept), PATH: path }
}

function findOnPath(context: Context): string | null {
  const { env, platform, deps } = context
  const api = pathApiFor(platform)
  const candidates = platform === 'win32' ? WIN32_CANDIDATES : POSIX_CANDIDATES
  const pathValue = readEnvironmentVariable(env, 'PATH', platform) ?? ''
  for (const directory of pathValue.split(api.delimiter)) {
    if (directory === '') {
      continue
    }
    for (const name of candidates) {
      const candidate = api.join(directory, name)
      if (!DESKTOP_APP_DIRECTORY.test(candidate) && deps.isFile(candidate)) {
        return candidate
      }
    }
  }
  return null
}

/** An explicit node must be a plain absolute executable; a batch file would reach cmd.exe. */
function explicitNodeHost(nodePath: string, context: Context): NodeHost {
  const { platform, deps } = context
  const extension = pathApiFor(platform).extname(nodePath).toLowerCase()
  const wrongKind =
    SHELL_EXTENSIONS.includes(extension) || (platform === 'win32' && extension !== '.exe')
  if (!isLocalAbsolutePath(nodePath, platform) || wrongKind) {
    throw new CodexExecutableError(
      'invalid_selection',
      'The node path must be an absolute local executable, not a script or network path.'
    )
  }
  if (!deps.isFile(nodePath)) {
    throw new CodexExecutableError('not_found', 'The node path does not exist.')
  }
  return { program: nodePath, electronRunAsNode: false }
}

/** Orca's own precedent for running a script from the main process: the app binary as Node. */
function nodeHostFor(nodePath: string | undefined, context: Context): NodeHost {
  return nodePath === undefined
    ? { program: context.execPath, electronRunAsNode: context.isElectron }
    : explicitNodeHost(nodePath, context)
}

function nodeEntryExecutable(
  entryPath: string,
  host: NodeHost,
  source: CodexExecutable['source']
): CodexExecutable {
  return {
    program: host.program,
    prefixArgs: [entryPath],
    entryPath,
    requestedPath: entryPath,
    launch: 'node-entry',
    source,
    electronRunAsNode: host.electronRunAsNode
  }
}

function fromShim(
  requestedPath: string,
  source: CodexExecutable['source'],
  context: Context
): CodexExecutable {
  const shim = context.deps.resolveShim(requestedPath, context.env)
  // Why: an unrecognised shim, or one that sets its own environment, runs as the .cmd itself;
  // Orca's process pipeline routes a .cmd through cmd.exe with its arguments encoded.
  if (shim === null || shim.env !== undefined) {
    return direct(requestedPath, requestedPath, source)
  }
  return {
    program: shim.program,
    prefixArgs: shim.prefixArgs,
    entryPath: shim.prefixArgs[0] ?? shim.program,
    requestedPath,
    launch: shim.prefixArgs.length > 0 ? 'node-entry' : 'direct',
    source,
    electronRunAsNode: false
  }
}

function direct(
  requestedPath: string,
  entryPath: string,
  source: CodexExecutable['source']
): CodexExecutable {
  return {
    program: requestedPath,
    prefixArgs: [],
    entryPath,
    requestedPath,
    launch: 'direct',
    source,
    electronRunAsNode: false
  }
}

function classifyInstalled(
  requestedPath: string,
  source: CodexExecutable['source'],
  context: Context
): CodexExecutable {
  const extension = pathApiFor(context.platform).extname(requestedPath).toLowerCase()
  if (NODE_ENTRY_EXTENSIONS.includes(extension)) {
    return nodeEntryExecutable(requestedPath, nodeHostFor(undefined, context), source)
  }
  if (context.platform !== 'win32') {
    return direct(requestedPath, context.deps.realPath(requestedPath), source)
  }
  if (extension === '.exe' || extension === '.bat') {
    return direct(requestedPath, requestedPath, source)
  }
  if (extension === '.cmd') {
    return fromShim(requestedPath, source, context)
  }
  if (extension === '.ps1') {
    const pathValue = readEnvironmentVariable(context.env, 'PATH', context.platform) ?? ''
    const target = powerShellScriptTarget(
      requestedPath,
      context.env,
      pathValue,
      context.deps.isFile
    )
    return {
      ...target,
      entryPath: requestedPath,
      requestedPath,
      launch: 'powershell-script',
      source,
      electronRunAsNode: false
    }
  }
  throw new CodexExecutableError(
    'invalid_selection',
    `A ${extension || 'extensionless'} codex path is not a launcher a shell would run.`
  )
}

function requireExistingFile(path: string, label: string, context: Context): void {
  if (!isLocalAbsolutePath(path, context.platform)) {
    throw new CodexExecutableError(
      'invalid_selection',
      `The ${label} must be an absolute local path.`
    )
  }
  if (!context.deps.isFile(path)) {
    throw new CodexExecutableError('not_found', `The ${label} does not exist.`)
  }
}

export function resolveCodexExecutable(
  selection: CodexExecutableSelection,
  options: CodexExecutableOptions = {}
): CodexExecutable {
  const platform = options.platform ?? process.platform
  const context: Context = {
    env: withSanitizedPath(options.env ?? process.env, platform, options.excludePathUnder ?? []),
    platform,
    deps: { ...DEFAULT_DEPS, ...options.deps },
    isElectron: options.isElectron ?? Boolean(process.versions.electron),
    execPath: options.execPath ?? process.execPath
  }
  if (selection.kind === 'node-entry') {
    requireExistingFile(selection.entryPath, 'node entry path', context)
    const host = nodeHostFor(selection.nodePath, context)
    return nodeEntryExecutable(selection.entryPath, host, 'node-entry')
  }
  if (selection.codexPath !== undefined) {
    requireExistingFile(selection.codexPath, 'codex path', context)
    return classifyInstalled(selection.codexPath, 'explicit', context)
  }
  const found = findOnPath(context)
  if (found === null) {
    throw new CodexExecutableError('not_found', 'No codex executable was found on PATH.')
  }
  return classifyInstalled(found, 'path-search', context)
}

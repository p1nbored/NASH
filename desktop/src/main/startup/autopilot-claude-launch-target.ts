import { realpathSync, statSync } from 'node:fs'
import { resolveClaudeCommand } from '../../shared/node-cli-command-resolution'
import type { LaunchTarget } from '../agent-exec-shared/launch-target'
import { isLocalAbsolutePath, pathApiFor } from '../agent-exec-shared/path-containment'
import { powerShellScriptTarget } from '../agent-exec-shared/powershell-script-launch'

// The installed Claude Code, as a `claude -p` reviewer launches it. Read on demand only: resolving
// it checks files on PATH and starts nothing.

export type ClaudeLaunchTargetDeps = {
  /** Orca's own Claude command lookup; it returns the bare name when nothing is installed. */
  readonly resolveCommand: () => string
  readonly isFile: (path: string) => boolean
  readonly realPath: (path: string) => string
  readonly platform: NodeJS.Platform
  /** Where PowerShell is looked up for a `.ps1` launcher. */
  readonly env: NodeJS.ProcessEnv
}

const DEFAULT_DEPS: ClaudeLaunchTargetDeps = {
  resolveCommand: () => resolveClaudeCommand(),
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
  },
  platform: process.platform,
  env: process.env
}

/** D-023 amendment: on Windows the installed launcher starts as a shell would start it. */
const WIN32_LAUNCHER_EXTENSIONS = ['.exe', '.cmd', '.bat', '.ps1']

export function resolveClaudeLaunchTarget(
  overrides: Partial<ClaudeLaunchTargetDeps> = {}
): LaunchTarget | null {
  const deps = { ...DEFAULT_DEPS, ...overrides }
  const path = deps.resolveCommand()
  if (!isLocalAbsolutePath(path, deps.platform)) {
    return null
  }
  const extension = pathApiFor(deps.platform).extname(path).toLowerCase()
  if (deps.platform === 'win32' && !WIN32_LAUNCHER_EXTENSIONS.includes(extension)) {
    return null
  }
  if (!deps.isFile(path)) {
    return null
  }
  if (deps.platform === 'win32' && extension === '.ps1') {
    const pathValue = deps.env.PATH ?? deps.env.Path ?? ''
    return {
      ...powerShellScriptTarget(path, deps.env, pathValue, deps.isFile),
      entryPath: path,
      requestedPath: path,
      launch: 'powershell-script',
      electronRunAsNode: false
    }
  }
  return {
    program: path,
    prefixArgs: [],
    entryPath: deps.realPath(path),
    requestedPath: path,
    launch: 'direct',
    electronRunAsNode: false
  }
}

import { realpathSync } from 'node:fs'
import type { LaunchTarget } from './launch-target'
import { isLocalAbsolutePath, isPathInside, pathApiFor } from './path-containment'
import { POWERSHELL_SCRIPT_PREFIX } from './powershell-script-launch'

// A runner trusts nothing about a hand-built launch description; it is re-checked here just before launch.

export type ExecutableCheckContext = {
  readonly worktreePath: string
  readonly runDir: string
  readonly platform: NodeJS.Platform
  readonly electron: { readonly isElectron: boolean; readonly execPath: string }
  /** Resolves links, so a path that points into the worktree is judged by where it lands. */
  readonly realPath: (path: string) => string
}

export function defaultRealPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

function isLaunchDescription(value: unknown): value is LaunchTarget {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const { program, prefixArgs, entryPath, launch }: Record<string, unknown> = { ...value }
  return (
    typeof program === 'string' &&
    typeof entryPath === 'string' &&
    Array.isArray(prefixArgs) &&
    prefixArgs.every((arg) => typeof arg === 'string') &&
    (launch === 'direct' || launch === 'node-entry' || launch === 'powershell-script')
  )
}

function insideFence(path: string, context: ExecutableCheckContext): boolean {
  const fences = [context.worktreePath, context.runDir]
  const candidates = [path, context.realPath(path)]
  return candidates.some((candidate) =>
    fences.some((fence) => isPathInside(candidate, fence, context.platform))
  )
}

function programProblem(executable: LaunchTarget, context: ExecutableCheckContext): string | null {
  const api = pathApiFor(context.platform)
  const { program } = executable
  if (!isLocalAbsolutePath(program, context.platform)) {
    return 'The program must be an absolute local path.'
  }
  if (insideFence(program, context)) {
    return 'The program must not live inside the worktree or the run directory.'
  }
  const sameAsApp =
    api.resolve(program).toLowerCase() === api.resolve(context.electron.execPath).toLowerCase()
  if (context.electron.isElectron && sameAsApp && executable.electronRunAsNode !== true) {
    return 'The Electron binary can only run codex as Node with ELECTRON_RUN_AS_NODE.'
  }
  return null
}

function launchProblem(executable: LaunchTarget, context: ExecutableCheckContext): string | null {
  if (!isLocalAbsolutePath(executable.entryPath, context.platform)) {
    return 'The entry path must be an absolute local path.'
  }
  if (executable.launch === 'direct' && executable.prefixArgs.length > 0) {
    return 'A direct launch takes no prefix arguments.'
  }
  const [only] = executable.prefixArgs
  if (
    executable.launch === 'node-entry' &&
    (executable.prefixArgs.length !== 1 || only !== executable.entryPath)
  ) {
    return 'A node launch takes exactly the entry script as its prefix argument.'
  }
  const expectedScriptPrefix = [...POWERSHELL_SCRIPT_PREFIX, executable.entryPath]
  if (
    executable.launch === 'powershell-script' &&
    (executable.prefixArgs.length !== expectedScriptPrefix.length ||
      executable.prefixArgs.some((arg, index) => arg !== expectedScriptPrefix[index]))
  ) {
    return 'A PowerShell launch takes exactly -NoProfile -File and the script as its prefix arguments.'
  }
  return insideFence(executable.entryPath, context)
    ? 'The entry file must not live inside the worktree or the run directory.'
    : null
}

/** The first reason this launch target must not be started, or null. */
export function findExecutableProblem(
  value: unknown,
  context: ExecutableCheckContext
): string | null {
  if (!isLaunchDescription(value)) {
    return 'The executable is not a launch description.'
  }
  return programProblem(value, context) ?? launchProblem(value, context)
}

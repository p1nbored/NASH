import { win32 as pathWin32 } from 'node:path'
import { windowsPowerShellPath } from '../../shared/child-process/windows-system-binary'

// D-023 amendment: a CLI installed only as a `.ps1` launcher starts the way a shell would run it.

export const POWERSHELL_SCRIPT_PREFIX = ['-NoProfile', '-File'] as const

export type PowerShellScriptTarget = {
  readonly program: string
  readonly prefixArgs: readonly string[]
}

/**
 * PowerShell 7 (`pwsh.exe`) from the given PATH when present, else Windows PowerShell. The user's
 * execution policy applies unchanged: no `-ExecutionPolicy` override is ever added.
 */
export function powerShellScriptTarget(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  pathValue: string,
  isFile: (path: string) => boolean
): PowerShellScriptTarget {
  const pwsh = pathValue
    .split(pathWin32.delimiter)
    .filter((directory) => directory !== '' && pathWin32.isAbsolute(directory))
    .map((directory) => pathWin32.join(directory, 'pwsh.exe'))
    .find((candidate) => isFile(candidate))
  return {
    program: pwsh ?? windowsPowerShellPath(env),
    prefixArgs: [...POWERSHELL_SCRIPT_PREFIX, scriptPath]
  }
}

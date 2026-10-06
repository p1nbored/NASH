import { isLocalAbsolutePath, isPathInside, pathApiFor } from './path-containment'

// A child environment is an allowlist, never a filtered copy; the secret-name rule is a second check on it.

const WINDOWS_ALLOWED = [
  'SystemRoot',
  'windir',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'APPDATA'
] as const

const POSIX_ALLOWED = ['HOME'] as const

const SECRET_SUFFIX = /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PAT|AUTH|CREDENTIALS?)$/i
const SECRET_PREFIX =
  /^(?:OPENAI_|ANTHROPIC_|CLAUDE|GEMINI_|GOOGLE_|AGY_CLI_|AUTOPILOT_CLEF_|AWS_)/i
const SECRET_EXACT = /^CODEX_API_KEY$/i

/** True for a name that must never reach a child, whatever the allowlist says. */
export function isSecretLikeEnvName(name: string): boolean {
  return SECRET_SUFFIX.test(name) || SECRET_PREFIX.test(name) || SECRET_EXACT.test(name)
}

export type SanitizePathOptions = {
  readonly platform: NodeJS.Platform
  /** Directories whose subtrees are dropped, so a repository cannot shadow a tool by name. */
  readonly excludePathUnder?: readonly string[]
}

/** Keep absolute local, unique entries in order; relative, empty and UNC ones can reach the worktree or network. */
export function sanitizePathList(
  pathValue: string | undefined,
  options: SanitizePathOptions
): string {
  const api = pathApiFor(options.platform)
  const excluded = options.excludePathUnder ?? []
  const kept: string[] = []
  const seen = new Set<string>()
  for (const raw of (pathValue ?? '').split(api.delimiter)) {
    const entry = raw.trim().replace(/^"(.*)"$/, '$1')
    if (!isLocalAbsolutePath(entry, options.platform)) {
      continue
    }
    const folded =
      options.platform === 'win32' ? api.resolve(entry).toLowerCase() : api.resolve(entry)
    if (excluded.some((dir) => isPathInside(entry, dir, options.platform)) || seen.has(folded)) {
      continue
    }
    seen.add(folded)
    kept.push(entry)
  }
  return kept.join(api.delimiter)
}

export type AgentExecEnvironmentInput = {
  readonly parentEnv: NodeJS.ProcessEnv
  /** Absolute, run-local directory exposed as TEMP/TMP (win32) or TMPDIR (posix). */
  readonly runTempDir: string
  readonly platform?: NodeJS.Platform
  /** Subtrees dropped from PATH, and refused for a passthrough directory. */
  readonly excludePathUnder?: readonly string[]
  /** Directory-valued variables copied through when absolute, local and outside the excluded subtrees, such as a CLI's home that holds its saved login. */
  readonly passthroughDirectoryNames?: readonly string[]
  /** The launch target is the Electron binary, which only acts as Node with this variable set. */
  readonly electronRunAsNode?: boolean
}

/** Case-insensitive on win32, where the OS treats `Path` and `PATH` as one variable. */
export function readEnvironmentVariable(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform
): string | undefined {
  if (platform !== 'win32') {
    return env[name]
  }
  const lower = name.toLowerCase()
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === lower)
  return key === undefined ? undefined : env[key]
}

/** A relative directory resolves in the worktree, and one inside it is writable by the model. */
function directoryUsable(
  value: string,
  platform: NodeJS.Platform,
  excluded: readonly string[]
): boolean {
  return (
    isLocalAbsolutePath(value, platform) &&
    !excluded.some((dir) => isPathInside(value, dir, platform))
  )
}

function copyAllowlisted(
  input: AgentExecEnvironmentInput,
  platform: NodeJS.Platform
): Record<string, string> {
  const excluded = input.excludePathUnder ?? []
  const passthrough = input.passthroughDirectoryNames ?? []
  const names = [...(platform === 'win32' ? WINDOWS_ALLOWED : POSIX_ALLOWED), ...passthrough]
  const env: Record<string, string> = {}
  for (const name of names) {
    const value = readEnvironmentVariable(input.parentEnv, name, platform)
    if (value === undefined || value === '') {
      continue
    }
    if (passthrough.includes(name) && !directoryUsable(value, platform, excluded)) {
      continue
    }
    env[name] = value
  }
  return env
}

/** Build the child environment: allowlisted names only, sanitized PATH, run-local temp. */
export function buildAgentExecEnvironment(
  input: AgentExecEnvironmentInput
): Record<string, string> {
  const platform = input.platform ?? process.platform
  if (!isLocalAbsolutePath(input.runTempDir, platform)) {
    throw new Error('runTempDir must be an absolute local path.')
  }
  const env = copyAllowlisted(input, platform)
  const pathValue = sanitizePathList(readEnvironmentVariable(input.parentEnv, 'PATH', platform), {
    platform,
    excludePathUnder: input.excludePathUnder
  })
  if (pathValue !== '') {
    env.PATH = pathValue
  }
  if (platform === 'win32') {
    env.TEMP = input.runTempDir
    env.TMP = input.runTempDir
    env.NoDefaultCurrentDirectoryInExePath = '1'
  } else {
    env.TMPDIR = input.runTempDir
  }
  if (input.electronRunAsNode === true) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  const leaked = Object.keys(env).filter(isSecretLikeEnvName)
  if (leaked.length > 0) {
    throw new Error(`Allowlist produced secret-like names: ${leaked.join(', ')}`)
  }
  return env
}

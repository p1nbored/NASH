import { APP_HOME_DIR_NAME } from '../../../shared/app-identity-paths'
import {
  containsDirectory,
  normalizePathForMatching,
  rawSegmentsOf
} from './permission-path-normalization'

// Claude Code's protected paths (permission-modes.md, "Protected paths"): never auto-approved.
const PROTECTED_DIRECTORIES = new Set([
  '.git',
  '.vscode',
  '.idea',
  '.husky',
  '.cargo',
  '.devcontainer',
  '.yarn',
  '.mvn',
  '.claude'
])
const PROTECTED_FILES = new Set([
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.bash_aliases',
  '.bash_logout',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.zlogin',
  '.zlogout',
  '.profile',
  '.envrc',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.pnp.cjs',
  '.pnp.loader.mjs',
  '.pnpmfile.cjs',
  'bunfig.toml',
  '.bunfig.toml',
  '.bazelrc',
  '.bazelversion',
  '.bazeliskrc',
  '.pre-commit-config.yaml',
  'lefthook.yml',
  'lefthook.yaml',
  '.lefthook.yml',
  '.lefthook.yaml',
  'gradle-wrapper.properties',
  'maven-wrapper.properties',
  '.devcontainer.json',
  '.ripgreprc',
  'pyrightconfig.json',
  '.mcp.json',
  '.claude.json',
  // The PowerShell counterparts of the shell profiles above.
  'profile.ps1',
  'microsoft.powershell_profile.ps1'
])
// Credential stores: a read would put a secret into the session, so dot never approves one. The
// app's home folder holds its sealed stores and the hook scripts that relay these very prompts.
const CREDENTIAL_DIRECTORIES = new Set(['.ssh', '.aws', '.gnupg', APP_HOME_DIR_NAME.toLowerCase()])
const CREDENTIAL_FILES = new Set([
  '.netrc',
  '_netrc',
  '.pypirc',
  '.git-credentials',
  '.credentials.json',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  // The CLI's RPC auth token and the dot ingress token (runtime-bootstrap, dot-ingress-metadata).
  'orca-runtime.json',
  'dot-ingress-runtime.json'
])
// `.enc`: the app's sealed credential stores (Clef, dot remote, provider keys).
const CREDENTIAL_FILE_SHAPES = [/^\.env(\..+)?$/, /\.(pem|key|p12|pfx|enc)$/]
// A glob segment starting with a dot can match any protected dot name, so it counts as one.
const DOT_LEADING_GLOB = /^\.[^*?[{]*[*?[{]/

export type SensitivePathContext = {
  /** What a relative path is resolved against: the working directory, or a Glob's search root. */
  readonly base: string | null
  /** The app's own data folders as normalized segments; everything below them is desktop-only. */
  readonly appData: readonly (readonly string[])[]
}

function isSensitiveSegment(segment: string, next: string | undefined): boolean {
  return (
    (segment === '.config' && next === 'git') ||
    PROTECTED_DIRECTORIES.has(segment) ||
    PROTECTED_FILES.has(segment) ||
    CREDENTIAL_DIRECTORIES.has(segment) ||
    CREDENTIAL_FILES.has(segment) ||
    CREDENTIAL_FILE_SHAPES.some((shape) => shape.test(segment)) ||
    DOT_LEADING_GLOB.test(segment)
  )
}

/**
 * True when any segment names a protected or credential location. `.claude/worktrees` is exempt
 * only where `worktrees` follows `.claude` in these segments, so callers pass resolved segments.
 */
export function segmentsAreSensitive(
  segments: readonly string[],
  options: { exemptWorktrees: boolean } = { exemptWorktrees: true }
): boolean {
  return segments.some((segment, index) => {
    const next = segments[index + 1]
    if (options.exemptWorktrees && segment === '.claude' && next === 'worktrees') {
      return false
    }
    return isSensitiveSegment(segment, next)
  })
}

/** The app data folders as the checks compare them; an unreadable or empty one is dropped. */
export function normalizeAppDataDirectories(directories: readonly string[]): (readonly string[])[] {
  return directories.flatMap((directory) => {
    const normalized = normalizePathForMatching(directory)
    return normalized && normalized.length > 0 ? [normalized] : []
  })
}

/** True when the path lies in one of the app's data folders. */
export function isInAppData(segments: readonly string[], context: SensitivePathContext): boolean {
  return context.appData.some((directory) => containsDirectory(segments, directory))
}

/**
 * True when the path names a protected or credential location as written or once resolved, uses
 * a Windows alias form, or lies in the app's data folder. Checking both forms means resolving
 * `..` can only add a match, never remove one.
 */
export function isSensitivePath(path: string, context: SensitivePathContext): boolean {
  if (segmentsAreSensitive(rawSegmentsOf(path))) {
    return true
  }
  const normalized = normalizePathForMatching(path, context.base)
  return normalized === null || segmentsAreSensitive(normalized) || isInAppData(normalized, context)
}

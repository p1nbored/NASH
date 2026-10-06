import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { readKeychainPassword } from '../macos-keychain/generic-password'

const ACTIVE_CLAUDE_SERVICE = 'Claude Code-credentials'

// Why reads only: Claude runs on the user's own login, so NASH never writes or deletes a Keychain item.
export async function readActiveClaudeKeychainCredentials(
  configDir?: string
): Promise<string | null> {
  for (const service of getActiveClaudeServices(configDir)) {
    const credentials = await readKeychainPassword(service, getKeychainUser())
    if (credentials) {
      return credentials
    }
  }
  return null
}

export async function readActiveClaudeKeychainCredentialsStrict(
  configDir?: string
): Promise<string | null> {
  if (!configDir) {
    return readKeychainPassword(getActiveClaudeService(), getKeychainUser())
  }
  // Why: macOS tmp is /var → /private/var. Claude hashes the realpath; a
  // mkdtemp login dir would miss the Keychain item if we only hashed the raw path.
  for (const dir of claudeConfigDirKeychainAliases(configDir)) {
    const credentials = await readKeychainPassword(getActiveClaudeService(dir), getKeychainUser())
    if (credentials) {
      return credentials
    }
  }
  return null
}

const KEYCHAIN_ACCOUNT_PATTERN = /^[a-zA-Z0-9._-]+$/
const CLAUDE_CODE_FALLBACK_USER = 'claude-code-user'

function getKeychainUser(): string {
  // Why: Claude Code 2.1+ rejects $USER outside [a-zA-Z0-9._-] (SSO names like
  // first@example.com) and stores the item under claude-code-user (#12857).
  let user: string
  try {
    user = process.env.USER || process.env.USERNAME || userInfo().username
  } catch {
    return CLAUDE_CODE_FALLBACK_USER
  }
  return KEYCHAIN_ACCOUNT_PATTERN.test(user) ? user : CLAUDE_CODE_FALLBACK_USER
}

function getActiveClaudeService(configDir?: string): string {
  if (!configDir) {
    return ACTIVE_CLAUDE_SERVICE
  }
  // Why: Claude Code 2.1+ scopes macOS Keychain credentials by config dir
  // using the first 8 hex chars of sha256(NFC(CLAUDE_CONFIG_DIR)).
  const suffix = createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8)
  return `${ACTIVE_CLAUDE_SERVICE}-${suffix}`
}

export function claudeConfigDirKeychainAliases(configDir: string): string[] {
  const aliases = [configDir]
  const missingSegments: string[] = []
  let existingPath = configDir
  while (true) {
    try {
      const canonical = join(realpathSync(existingPath), ...missingSegments)
      if (canonical !== configDir) {
        aliases.push(canonical)
      }
      break
    } catch (error) {
      // Missing paths with parent traversal cannot prove an alias across symlinks.
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT' ||
        configDir.split(/[\\/]/).includes('..')
      ) {
        break
      }
      try {
        // A broken symlink has no known canonical target; do not guess its alias.
        lstatSync(existingPath)
        break
      } catch (missingError) {
        if (
          !(missingError instanceof Error) ||
          !('code' in missingError) ||
          missingError.code !== 'ENOENT'
        ) {
          break
        }
      }
      const parent = dirname(existingPath)
      if (parent === existingPath) {
        break
      }
      // Preserve canonical Keychain lookup without recreating a removed config directory.
      missingSegments.unshift(basename(existingPath))
      existingPath = parent
    }
  }
  return aliases
}

function getActiveClaudeServices(configDir?: string): string[] {
  if (!configDir) {
    return [ACTIVE_CLAUDE_SERVICE]
  }
  const scoped = claudeConfigDirKeychainAliases(configDir).map((dir) => getActiveClaudeService(dir))
  return [...new Set([...scoped, ACTIVE_CLAUDE_SERVICE])]
}

import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'
import { isAntigravityFileStorageHost } from './native-credential-backend'
import { createEncryptedAntigravityAccountStore } from './native-account-store'
import { getAntigravityAccountService, getAntigravityAccountVaultPath } from './native-account-host'

// agy is Go: os.UserHomeDir reads USERPROFILE on Windows and HOME elsewhere.
const WINDOWS_HOME_KEY = 'USERPROFILE'

function isWindowsHomeKey(key: string): boolean {
  return key.toUpperCase() === WINDOWS_HOME_KEY
}

function readLaunchHomes(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') {
    const home = env.HOME ?? env.USERPROFILE
    return home ? [home] : []
  }
  // Windows names are case-insensitive, but a copied env object can hold several casings and the
  // spawner decides which one agy sees, so every one must match.
  return Object.entries(env).flatMap(([key, value]) =>
    isWindowsHomeKey(key) && value ? [value] : []
  )
}

function deletesLaunchHome(envToDelete: readonly string[] | undefined): boolean {
  return (envToDelete ?? []).some((key) =>
    process.platform === 'win32' ? isWindowsHomeKey(key) : ['HOME', 'USERPROFILE'].includes(key)
  )
}

function isSameHome(left: string, right: string): boolean {
  if (process.platform !== 'win32') {
    return posix.resolve(left) === posix.resolve(right)
  }
  return win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase()
}

export async function prepareAntigravityAccountForLaunch(args: {
  launchAgent?: string
  command?: string
  connectionId?: string | null
  isWsl?: boolean
  env?: NodeJS.ProcessEnv
  envIsComplete?: boolean
  envToDelete?: readonly string[]
}): Promise<void> {
  const agent =
    args.launchAgent ??
    (args.command ? recognizeAgentProcessFromCommandLine(args.command)?.agent : null)
  // Client snapshots never select accounts for a relay or a client-selected distro.
  if (agent !== 'antigravity' || args.connectionId || args.isWsl) {
    return
  }
  const path = getAntigravityAccountVaultPath()
  if (!existsSync(path)) {
    return
  }
  if (!createEncryptedAntigravityAccountStore(path).read().selectedAccountId) {
    return
  }
  const env = args.envIsComplete ? { ...args.env } : { ...process.env, ...args.env }
  for (const key of args.envToDelete ?? []) {
    delete env[key]
  }
  if (
    deletesLaunchHome(args.envToDelete) ||
    readLaunchHomes(env).some((home) => !isSameHome(home, getAppEnvironment().getPath('home'))) ||
    isAntigravityFileStorageHost(env) !== isAntigravityFileStorageHost(process.env)
  ) {
    throw new Error(
      'This agy launch uses a different credential authority from the selected Antigravity account.'
    )
  }
  await getAntigravityAccountService({ runtime: 'host' }).prepareForLaunch()
}

import { join } from 'node:path'
import { APP_IDENTITY } from '../../shared/app-identity-constants'

// Why `orca-ide` on Linux: GNOME Orca ships /usr/bin/orca, so the CLI never claims that name.
// Why unchanged for NASH: the Linux packaging pass is a follow-up to D-017; macOS and Windows already use the NASH name.
export const LINUX_CLI_COMMAND_NAME = 'orca-ide'

// Why: agents and skills inside NASH terminals still call bare `orca`; the alias lives in its own directory
// so the global PATH registration (resources/bin) never puts an `orca` ahead of a real Orca install's.
const SESSION_ALIAS_DIR_NAME = 'session-bin'

export function getSessionAliasBinDir(resourcesPath: string): string {
  return join(resourcesPath, SESSION_ALIAS_DIR_NAME)
}

/** Absolute path of the CLI launcher this app ships in its own resources bundle.
 *  Lives apart from cli-installer so callers that only need the path (PTY env
 *  assembly) don't pull in the installer's `electron` dependency. */
export function getBundledLauncherPath(
  platform: NodeJS.Platform,
  resourcesPath: string
): string | null {
  if (platform === 'darwin') {
    return join(resourcesPath, 'bin', APP_IDENTITY.cliCommandName)
  }
  if (platform === 'linux') {
    return join(resourcesPath, 'bin', LINUX_CLI_COMMAND_NAME)
  }
  if (platform === 'win32') {
    return join(resourcesPath, 'bin', `${APP_IDENTITY.cliCommandName}.exe`)
  }
  return null
}

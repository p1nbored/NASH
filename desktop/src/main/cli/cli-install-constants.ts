import { APP_IDENTITY } from '../../shared/app-identity-constants'

export const DEFAULT_MAC_COMMAND_PATH = `/usr/local/bin/${APP_IDENTITY.cliCommandName}`
export const DEV_COMMAND_NAME = APP_IDENTITY.devCliCommandName
// Why: agents inside NASH dev terminals still call `orca` or `orca-dev`; the aliases sit beside the nash-dev launcher, never on the global PATH.
export const DEV_SESSION_ALIAS_COMMAND_NAMES = ['orca', 'orca-dev'] as const
export const DEV_LAUNCHER_DIR = ['cli', 'bin'] as const
export const WINDOWS_PATH_WRITE_TIMEOUT_MS = 5_000

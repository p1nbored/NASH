import { APP_IDENTITY } from './app-identity-constants'

// Per-user folders the app owns, all derived from the identity data folder name (decision D-017) so
// NASH can never read or write a folder a real Orca install uses on the same machine or remote host.
const name = APP_IDENTITY.userDataDirName

/** `~/.nash`: agent hook scripts, credential stores, keybindings and the relay session folder. */
export const APP_HOME_DIR_NAME = `.${name}`

/** `~/.nash-relay`: relay wrapper and hook state on a remote host. */
export const APP_RELAY_HOME_DIR_NAME = `.${name}-relay`

/** `~/.nash-remote`: relay and runtime installs the app uploads to a remote host. */
export const APP_REMOTE_DIR_NAME = `.${name}-remote`

/** `~/.nash-wsl`: hook and browser relays inside a WSL guest. */
export const APP_WSL_DIR_NAME = `.${name}-wsl`

/** Folder name under the XDG data and cache roots (`~/.local/share/nash`, `~/.cache/nash`) for per-user app data. */
export const APP_XDG_DATA_DIR_NAME = name

/** Path of the per-user data folder relative to a home folder (`.local/share/nash`), e.g. WSL account homes. */
export const APP_XDG_DATA_HOME_PATH = `.local/share/${name}`

/** Segments under the home folder of the default parent for new projects (`~/nash/projects`). */
export const APP_DEFAULT_PROJECTS_DIR_SEGMENTS: readonly string[] = [name, 'projects']

/** Segments under the home folder of the default workspace root (`~/nash/workspaces`). */
export const APP_DEFAULT_WORKSPACES_DIR_SEGMENTS: readonly string[] = [name, 'workspaces']

/** POSIX form of the shared agent-hook script folder, relative to a home folder. */
export const APP_AGENT_HOOKS_HOME_PATH = `${APP_HOME_DIR_NAME}/agent-hooks`

/** Windows form of {@link APP_AGENT_HOOKS_HOME_PATH}. */
export const APP_AGENT_HOOKS_HOME_PATH_WINDOWS = `${APP_HOME_DIR_NAME}\\agent-hooks`

import { APP_XDG_DATA_DIR_NAME } from '../../shared/app-identity-paths'

/** Guest-relative layout of the app's WSL CODEX_HOME, under the NASH data folder. */
export const WSL_CODEX_RUNTIME_HOME_SEGMENTS = [
  '.local',
  'share',
  APP_XDG_DATA_DIR_NAME,
  'codex-runtime-home',
  'home'
] as const

export function wslCodexRuntimeHomeForGuestHome(guestHome: string): string {
  const home = guestHome.endsWith('/') ? guestHome.slice(0, -1) : guestHome
  return `${home}/${WSL_CODEX_RUNTIME_HOME_SEGMENTS.join('/')}`
}

export function isHostCodexHomeForWsl(value: string | undefined): boolean {
  const trimmed = value?.trim()
  if (!trimmed) {
    return false
  }
  return /^[A-Za-z]:(?:[\\/]|$)/.test(trimmed) || trimmed.startsWith('\\\\')
}

export function isWslCodexHomeForHost(value: string | undefined): boolean {
  const trimmed = value?.trim()
  if (!trimmed) {
    return false
  }
  return trimmed.startsWith('/')
}

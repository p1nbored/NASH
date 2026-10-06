// FIXTURE_ONLY: per-platform application-data layouts shared by the NASH userData isolation tests,
// which run in different tsc projects (the Electron side in main, the CLI side in cli).
export type UserDataPlatformCase = {
  platform: 'win32' | 'darwin' | 'linux'
  home: string
  // Electron's app.getPath('appData') for this layout, which the CLI must derive from the environment.
  appData: string
  env: Record<string, string | undefined>
}

export const USER_DATA_PLATFORM_CASES: UserDataPlatformCase[] = [
  {
    platform: 'win32',
    home: 'C:\\Users\\tester',
    appData: 'C:\\Users\\tester\\AppData\\Roaming',
    env: { APPDATA: 'C:\\Users\\tester\\AppData\\Roaming', XDG_CONFIG_HOME: undefined }
  },
  {
    platform: 'darwin',
    home: '/Users/tester',
    appData: '/Users/tester/Library/Application Support',
    env: { APPDATA: undefined, XDG_CONFIG_HOME: undefined }
  },
  {
    platform: 'linux',
    home: '/home/tester',
    appData: '/home/tester/.config',
    env: { APPDATA: undefined, XDG_CONFIG_HOME: undefined }
  },
  {
    platform: 'linux',
    home: '/home/tester',
    appData: '/srv/xdg-config',
    env: { APPDATA: undefined, XDG_CONFIG_HOME: '/srv/xdg-config' }
  }
]

// FIXTURE_ONLY: the folder names a real Orca install uses; NASH must never resolve to them.
export const ORCA_USER_DATA_DIR_NAME = 'orca'
export const ORCA_DEV_USER_DATA_DIR_NAME = 'orca-dev'

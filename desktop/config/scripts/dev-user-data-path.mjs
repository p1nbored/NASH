import { createRequire } from 'node:module'
import path from 'node:path'

const { devUserDataDirName } = createRequire(import.meta.url)(
  '../../src/shared/app-identity-constants.json'
)

/**
 * The profile folder the NASH dev app uses, so the dev CLI and dev runner find its runtime metadata.
 * Why: mirrors configureDevUserDataPath in src/main/startup/configure-process.ts; keep the two in step.
 */
export function getDevUserDataPath({ platform = process.platform, env = process.env } = {}) {
  if (env.ORCA_DEV_USER_DATA_PATH) {
    return env.ORCA_DEV_USER_DATA_PATH
  }
  if (platform === 'darwin') {
    return path.join(env.HOME ?? '', 'Library', 'Application Support', devUserDataDirName)
  }
  if (platform === 'win32') {
    return path.join(
      env.APPDATA ?? path.join(env.USERPROFILE ?? '', 'AppData', 'Roaming'),
      devUserDataDirName
    )
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? '', '.config'), devUserDataDirName)
}

import type { autoUpdater as electronUpdaterAutoUpdater } from 'electron-updater'
import { requireAppUpdateFeed } from '../shared/app-update-feed'

export type ElectronAutoUpdater = typeof electronUpdaterAutoUpdater

export function loadElectronAutoUpdater(): ElectronAutoUpdater {
  // Why first: with no release feed the electron-updater module is never loaded, so nothing can check or download.
  requireAppUpdateFeed()
  // Why: electron-updater validates app.getVersion() while loading. Keep the
  // require behind packaged-update guards so direct dev/E2E launches do not
  // fail before setupAutoUpdater() can return.
  return (require('electron-updater') as { autoUpdater: ElectronAutoUpdater }).autoUpdater
}

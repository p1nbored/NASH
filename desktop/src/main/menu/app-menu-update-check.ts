import { getAppUpdateFeed } from '../../shared/app-update-feed'
import type { UpdateCheckOptions } from '../../shared/update-status-types'
import { translateMain } from '../i18n/main-i18n'

/**
 * The "Check for Updates..." menu entry, or none while the build has no release feed (D-026), since a
 * check could only fail. Modifier clicks are hidden power-user affordances shared by the macOS app menu
 * and the Windows/Linux Help menu, so both route RC and perf channels identically.
 */
export function createCheckForUpdatesMenuItems(options: {
  isMac: boolean
  onCheckForUpdates: (options: UpdateCheckOptions) => void
}): Electron.MenuItemConstructorOptions[] {
  if (getAppUpdateFeed() === null) {
    return []
  }
  const { isMac, onCheckForUpdates } = options
  const click: Electron.MenuItemConstructorOptions['click'] = (_menuItem, _window, event) => {
    const modifierClick = !event.triggeredByAccelerator
    const localBuild = isMac && modifierClick && event.altKey === true
    const includePerfPrerelease =
      !localBuild && modifierClick && (isMac ? event.metaKey === true : event.ctrlKey === true)
    const includePrerelease = !localBuild && modifierClick && event.shiftKey === true
    onCheckForUpdates({
      includePrerelease,
      includePerfPrerelease,
      ...(localBuild ? { localBuild: true } : {})
    })
  }
  return [{ label: translateMain('menu.checkForUpdates', 'Check for Updates...'), click }]
}

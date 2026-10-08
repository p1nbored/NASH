import { ORCA_ACCOUNT_AND_MOBILE_UI_ENABLED } from '../../../shared/nash-build-flags'
import type { SettingsNavigationTarget } from './settings-navigation-types'

// The dot and task routing cards keep their original `integrations-*` anchors; only the category that
// renders them moved (D-038), so links that still name Integrations land in the new category.
export const DOT_SETTINGS_ANCHOR_PREFIX = 'integrations-dot'
export const TASK_ROUTING_SETTINGS_ANCHOR_IDS: ReadonlySet<string> = new Set([
  'integrations-routing-table',
  'integrations-clef-routing'
])

function isHiddenPane(pane: SettingsNavigationTarget['pane']): boolean {
  return !ORCA_ACCOUNT_AND_MOBILE_UI_ENABLED && (pane === 'orca-account' || pane === 'mobile')
}

/** The target Settings should open, or null when it names a pane hidden in this build. */
export function normalizeSettingsNavigationTarget(
  target: SettingsNavigationTarget
): SettingsNavigationTarget | null {
  if (isHiddenPane(target.pane)) {
    return null
  }
  if (target.pane !== 'integrations' || target.sectionId === undefined) {
    return target
  }
  if (target.sectionId.startsWith(DOT_SETTINGS_ANCHOR_PREFIX)) {
    return { ...target, pane: 'dot' }
  }
  if (TASK_ROUTING_SETTINGS_ANCHOR_IDS.has(target.sectionId)) {
    return { ...target, pane: 'task-routing' }
  }
  return target
}

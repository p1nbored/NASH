import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../../../../shared/stable-pane-id'

type TabsByWorkspace = Readonly<Record<string, readonly { readonly id: string }[]>>

/** The open tab holding a run's primary pane in the run's own workspace, or null. */
export function findRunTerminalTabId(
  tabsByWorktree: TabsByWorkspace,
  workspaceId: string,
  paneKey: string | null
): string | null {
  if (!paneKey) {
    return null
  }
  const tabId = parsePaneKey(paneKey)?.tabId ?? parseLegacyNumericPaneKey(paneKey)?.tabId
  // Why hasOwn: workspace ids are data, so an id like `toString` must not read a prototype member.
  if (!tabId || !Object.hasOwn(tabsByWorktree, workspaceId)) {
    return null
  }
  return tabsByWorktree[workspaceId].some((tab) => tab.id === tabId) ? tabId : null
}

// Why no leaf id: the tab is shown, but keyboard focus stays in the Workbench panel.
export function showRunTerminal(tabId: string): void {
  activateTabAndFocusPane(tabId, null)
}

import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { CodexRestartNotice } from '../terminals/terminal-contracts'

export type DirectSshTerminalBindingState = {
  tabsByWorktree: Record<string, TerminalTab[]>
  ptyIdsByTabId: Record<string, string[]>
  pendingCodexPaneRestartIds: Record<string, true>
  codexRestartNoticeByPtyId: Record<string, CodexRestartNotice>
}

function clearPtyBinding(
  state: DirectSshTerminalBindingState,
  tab: TerminalTab,
  next: {
    ptyIdsByTabId: Record<string, string[]>
    pendingCodexPaneRestartIds: Record<string, true>
    codexRestartNoticeByPtyId: Record<string, CodexRestartNotice>
  }
): void {
  const clearedPtyIds = new Set([tab.ptyId, ...(state.ptyIdsByTabId[tab.id] ?? [])])
  next.ptyIdsByTabId[tab.id] = []
  for (const ptyId of clearedPtyIds) {
    if (!ptyId) {
      continue
    }
    delete next.pendingCodexPaneRestartIds[ptyId]
    delete next.codexRestartNoticeByPtyId[ptyId]
  }
}

export function clearDirectSshTerminalBindings(
  state: DirectSshTerminalBindingState,
  terminalWorkspaceKeys: ReadonlySet<string>
): { clearedCount: number; patch: Partial<DirectSshTerminalBindingState> | null } {
  let tabsByWorktree = state.tabsByWorktree
  const ptyIdsByTabId = { ...state.ptyIdsByTabId }
  const pendingCodexPaneRestartIds = { ...state.pendingCodexPaneRestartIds }
  const codexRestartNoticeByPtyId = { ...state.codexRestartNoticeByPtyId }
  let clearedCount = 0

  for (const workspaceKey of terminalWorkspaceKeys) {
    const tabs = state.tabsByWorktree[workspaceKey]
    if (!tabs) {
      continue
    }
    let nextTabs = tabs
    for (const [index, tab] of tabs.entries()) {
      if (tab.ptyId == null) {
        continue
      }
      const { pendingActivationSpawn: _pendingActivationSpawn, ...tabWithoutActivationSpawn } = tab
      void _pendingActivationSpawn
      if (nextTabs === tabs) {
        nextTabs = [...tabs]
      }
      nextTabs[index] = { ...tabWithoutActivationSpawn, ptyId: null }
      clearPtyBinding(state, tab, {
        ptyIdsByTabId,
        pendingCodexPaneRestartIds,
        codexRestartNoticeByPtyId
      })
      clearedCount += 1
    }
    if (nextTabs !== tabs) {
      if (tabsByWorktree === state.tabsByWorktree) {
        tabsByWorktree = { ...state.tabsByWorktree }
      }
      tabsByWorktree[workspaceKey] = nextTabs
    }
  }

  if (clearedCount === 0) {
    return { clearedCount, patch: null }
  }
  return {
    clearedCount,
    patch: {
      tabsByWorktree,
      ptyIdsByTabId,
      pendingCodexPaneRestartIds,
      codexRestartNoticeByPtyId
    }
  }
}

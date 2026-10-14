// Sole entry for old-client compatibility; enforced by config/scripts/check-compat-boundary-imports.mjs.
export {
  translateCreateTerminalTab,
  translateSessionTabClose,
  translateSessionTabMove,
  translateSetTabProps,
  translateTerminalClose,
  translateTerminalCloseTab,
  translateTerminalCreate,
  translateTerminalRename,
  translateTerminalSplit,
  type MethodTranslation,
  type SessionTabMoveErrorCode
} from './old-client-method-translation'
export {
  translateUpdatePaneLayout,
  type PaneLayoutTranslation,
  type SentPaneLayout
} from './old-client-pane-layout-translation'
export {
  projectSessionTabs,
  type ProjectedSessionTabs,
  type SessionTabsFacts,
  type SessionTabsView
} from './old-client-session-tabs-projection'

import React from 'react'
import { StatusBarSurface } from './StatusBarSurface'

export {
  buildCodexStatusSwitchGroups,
  getCodexStatusActiveId,
  normalizeCodexStatusRuntimeTarget,
  resolveCodexStatusAccountState
} from './status-bar-codex-accounts'
export {
  getStatusBarPreferredWslDistro,
  type CodexStatusRuntimeTarget,
  type CodexStatusSwitchGroup,
  type CodexStatusSwitchTarget
} from './status-bar-runtime-targets'
export { CodexSwitcherMenu } from './CodexSwitcherMenu'
export { InlineUsageBars } from './InlineProviderUsage'
export { ProviderDetailsMenu } from './ProviderDetailsMenu'
export { ProviderSegment } from './StatusBarProviderSegment'

export const StatusBar = React.memo(StatusBarSurface)

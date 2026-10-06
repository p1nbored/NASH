import {
  getAccountsCursorSearchEntries,
  getAccountsGrokSearchEntries,
  getAccountsMiniMaxSearchEntries,
  getAccountsOpencodeSearchEntries,
  getAccountsZcodePlanSearchEntries
} from './accounts-search'
import type { AccountsPaneSectionModel } from './accounts-pane-types'
import { renderOpenCodeAccountsSection } from './accounts-pane-provider-setting-sections'
import { renderMiniMaxAccountsSection } from './accounts-pane-minimax-section'
import { CursorAccountsSection } from './CursorAccountsSection'
import { GrokAccountsSection } from './GrokAccountsSection'
import { matchesSettingsSearch } from './settings-search'
import { UsageMetersOffNote } from './usage-meters-off-note'
import { ZcodePlanAccountsSection } from './ZcodePlanAccountsSection'

/**
 * The sections that only set up Orca's usage meters. With the meters off on the host (NASH) they
 * read no sign-in at all: one note takes their place.
 */
export function renderUsageProviderSections(
  model: AccountsPaneSectionModel,
  usageMetersOn: boolean
): (React.JSX.Element | null)[] {
  if (!usageMetersOn) {
    return [<UsageMetersOffNote key="usage-meters-off" />]
  }
  const { searchQuery } = model
  return [
    matchesSettingsSearch(searchQuery, getAccountsOpencodeSearchEntries())
      ? renderOpenCodeAccountsSection(model)
      : null,
    matchesSettingsSearch(searchQuery, getAccountsMiniMaxSearchEntries())
      ? renderMiniMaxAccountsSection(model)
      : null,
    matchesSettingsSearch(searchQuery, getAccountsGrokSearchEntries()) ? (
      <GrokAccountsSection key="grok" />
    ) : null,
    matchesSettingsSearch(searchQuery, getAccountsCursorSearchEntries()) ? (
      <CursorAccountsSection key="cursor" />
    ) : null,
    matchesSettingsSearch(searchQuery, getAccountsZcodePlanSearchEntries()) ? (
      <ZcodePlanAccountsSection key="zcode" />
    ) : null
  ]
}

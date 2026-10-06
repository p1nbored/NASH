import { describe, expect, it } from 'vitest'
import { usageRowMenuKind } from './status-bar-usage-row-menu'
import { getUsageProviderAccountsSectionId } from './usage-provider-settings-target'
import { hasUsageProviderSettingsForProvider } from './status-bar-provider-visibility'

describe('status bar without Claude account switching', () => {
  it('opens the plain details panel for Claude and keeps the Codex switcher', () => {
    expect(usageRowMenuKind('claude')).toBe('details')
    expect(usageRowMenuKind('codex')).toBe('codex-switcher')
    expect(usageRowMenuKind('antigravity')).toBe('details')
  })

  it('points Claude at the CLI usage section instead of a Claude accounts section', () => {
    expect(getUsageProviderAccountsSectionId('claude')).toBe('accounts-cli-usage')
    expect(getUsageProviderAccountsSectionId('codex')).toBe('accounts-codex')
  })

  it('earns no Claude bar from a retired managed-account setting', () => {
    // FIXTURE_ONLY: a settings object an older profile could still carry.
    const retired = {
      codexManagedAccounts: [],
      claudeManagedAccounts: [{ id: 'retired-claude' }]
    }

    expect(hasUsageProviderSettingsForProvider('claude', retired)).toBe(false)
  })
})

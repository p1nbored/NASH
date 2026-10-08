import { homedir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { normalizeLoadedGlobalSettings } from './normalize-loaded-global-settings'
import { prepareLoadedProfileSettings } from './prepare-loaded-profile-settings'
import { prepareLoadedTerminalSettings } from './prepare-loaded-terminal-settings'

function loadSettings(useOrcaPluginCatalog?: boolean): GlobalSettings {
  const defaults = getDefaultPersistedState(homedir())
  const settings: Partial<GlobalSettings> = { ...defaults.settings }
  delete settings.useOrcaPluginCatalog
  if (useOrcaPluginCatalog !== undefined) {
    settings.useOrcaPluginCatalog = useOrcaPluginCatalog
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a profile saved before the setting existed lacks only this key.
  const parsed: PersistedState = { ...defaults, settings: settings as GlobalSettings }
  const noop = (): void => {}
  const terminal = prepareLoadedTerminalSettings(parsed, noop)
  const profile = prepareLoadedProfileSettings(parsed, defaults, noop)
  return normalizeLoadedGlobalSettings(parsed, terminal, profile)
}

describe("Orca's plugin catalog setting on load (D-039)", () => {
  it('is off for a profile saved before the setting existed', () => {
    expect(loadSettings().useOrcaPluginCatalog).toBe(false)
  })

  it("keeps the user's saved choice", () => {
    expect(loadSettings(true).useOrcaPluginCatalog).toBe(true)
    expect(loadSettings(false).useOrcaPluginCatalog).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  migrateAgentYoloDefaults,
  stripRetiredGlobalSettings
} from './terminal-settings-migrations'

describe('migrateAgentYoloDefaults', () => {
  it('keeps newly added agent defaults manual for already migrated profiles', () => {
    const migrated = migrateAgentYoloDefaults({
      agentYoloDefaultsMigrated: true,
      agentDefaultArgs: { claude: '--dangerously-skip-permissions' },
      agentDefaultEnv: {}
    } as never)

    expect(migrated.agentDefaultArgs?.droid).toBe('')
    expect(migrated.agentDefaultEnv?.goose).toEqual({})
  })

  it('updates the previous Devin default for existing profiles', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This test only supplies the settings fields consumed by this migration.
    const migrated = migrateAgentYoloDefaults({
      agentYoloDefaultsMigrated: true,
      agentDefaultArgs: { devin: '--permission-mode bypass' },
      agentDefaultEnv: {}
    } as never)

    expect(migrated.agentDefaultArgs?.devin).toBe(
      '--permission-mode bypass --respect-workspace-trust false'
    )
  })
})

describe('stripRetiredGlobalSettings', () => {
  it('drops the retired Claude managed-account keys on load and on update', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: retired keys are no longer part of GlobalSettings.
    const stripped = stripRetiredGlobalSettings({
      claudeManagedAccounts: [{ id: 'retired-account' }],
      activeClaudeManagedAccountId: 'retired-account',
      activeClaudeManagedAccountIdsByRuntime: { host: 'retired-account', wsl: {} },
      machineName: 'kept'
    } as never)

    expect(stripped).toEqual({ machineName: 'kept' })
  })
})

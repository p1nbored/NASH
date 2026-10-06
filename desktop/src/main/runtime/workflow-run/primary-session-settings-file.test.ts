import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  PERMISSION_HOOK_TIMEOUT_SECONDS,
  PERMISSION_RELAY_WAIT_SECONDS
} from '../../../shared/workflow-run/autopilot-cli-commands'
import {
  buildPrimarySessionSettings,
  primarySessionSettingsPath,
  writePrimarySessionSettingsFile
} from './primary-session-settings-file'

const secureWrite = vi.hoisted(() => vi.fn(() => true))
// Why: the real writer restricts the Windows ACL by spawning icacls, which a unit test must not do.
vi.mock('../../../shared/secure-file', () => ({ writeSecureJsonFile: secureWrite }))

const USER_DATA = 'C:\\Users\\Test User\\AppData\\Roaming\\NASH'
const EXPECTED_ALLOW = [
  'Bash(orca orchestration task-propose *)',
  'Bash(orca orchestration task-start *)',
  'Bash(orca orchestration task-show *)',
  'Bash(orca orchestration task-report *)',
  'Bash(orca orchestration run-complete *)'
]

function settingsFor(access: 'read_only' | 'workspace_write', cliCommand = 'orca') {
  const result = buildPrimarySessionSettings({ access, cliCommand })
  if (!result.ok) {
    throw new Error(`expected settings, got ${result.refusal.code}`)
  }
  return result.value
}

describe('buildPrimarySessionSettings', () => {
  it('locks bypass and auto mode, turns auto review off in plan mode and registers the relay hook', () => {
    expect(settingsFor('read_only')).toEqual({
      permissions: {
        disableBypassPermissionsMode: 'disable',
        disableAutoMode: 'disable',
        allow: EXPECTED_ALLOW,
        deny: ['Edit', 'Write', 'NotebookEdit']
      },
      useAutoModeDuringPlan: false,
      hooks: {
        PermissionRequest: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'orca orchestration permission-request',
                timeout: PERMISSION_HOOK_TIMEOUT_SECONDS
              }
            ]
          }
        ]
      }
    })
  })

  it('denies no tool for workspace_write but keeps every lock and the same allow rules', () => {
    const settings = settingsFor('workspace_write')
    expect(settings.permissions.deny).toBeUndefined()
    expect(Object.keys(settings.permissions)).not.toContain('deny')
    expect(settings.permissions.disableBypassPermissionsMode).toBe('disable')
    expect(settings.permissions.disableAutoMode).toBe('disable')
    expect(settings.permissions.allow).toEqual(EXPECTED_ALLOW)
    expect(settings.useAutoModeDuringPlan).toBe(false)
  })

  it('denies Edit, Write and NotebookEdit at the tool level, with no path specifier', () => {
    const deny = settingsFor('read_only').permissions.deny ?? []
    expect([...deny].sort()).toEqual(['Edit', 'NotebookEdit', 'Write'])
    for (const rule of deny) {
      expect(rule).not.toContain('(')
    }
  })

  it('allows only the five task commands and nothing broader', () => {
    for (const access of ['read_only', 'workspace_write'] as const) {
      const allow = settingsFor(access).permissions.allow
      expect(allow).toHaveLength(5)
      for (const rule of allow) {
        expect(rule).toMatch(
          /^Bash\(orca orchestration (task-propose|task-start|task-show|task-report|run-complete) \*\)$/
        )
      }
      expect(allow.join('\n')).not.toContain('permission-request')
    }
  })

  it('writes an explicit integer hook timeout in seconds that outlasts the relay wait', () => {
    const [group] = settingsFor('read_only').hooks.PermissionRequest
    const [hook] = group.hooks
    expect(hook.timeout).toBe(PERMISSION_HOOK_TIMEOUT_SECONDS)
    expect(Number.isInteger(hook.timeout)).toBe(true)
    expect(hook.timeout).toBeGreaterThan(PERMISSION_RELAY_WAIT_SECONDS)
  })

  it('uses the CLI name it is given in the rules and the hook command', () => {
    const settings = settingsFor('read_only', 'orca-dev')
    expect(settings.permissions.allow[0]).toBe('Bash(orca-dev orchestration task-propose *)')
    expect(settings.hooks.PermissionRequest[0].hooks[0].command).toBe(
      'orca-dev orchestration permission-request'
    )
  })

  it('contains only keys that the local Claude Code settings reference documents', () => {
    const settings = settingsFor('read_only')
    expect(Object.keys(settings).sort()).toEqual(['hooks', 'permissions', 'useAutoModeDuringPlan'])
    expect(Object.keys(settings.permissions).sort()).toEqual([
      'allow',
      'deny',
      'disableAutoMode',
      'disableBypassPermissionsMode'
    ])
    expect(Object.keys(settings.hooks)).toEqual(['PermissionRequest'])
  })

  it('never carries a default mode, a bypass skip flag or a permission that loosens a lock', () => {
    const text = JSON.stringify(settingsFor('workspace_write'))
    expect(text).not.toContain('defaultMode')
    expect(text).not.toContain('skipDangerousModePermissionPrompt')
    expect(text).not.toContain('bypassPermissions')
    expect(text).not.toContain('"auto"')
  })

  it.each([
    ['empty', ''],
    ['with a space', 'or ca'],
    ['with a rule terminator', 'orca) Bash(x']
  ])('refuses a CLI name %s', (_label, cliCommand) => {
    const result = buildPrimarySessionSettings({ access: 'read_only', cliCommand })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_cli_name_invalid')
    }
  })

  it('adds the status-line relay and changes nothing else', () => {
    const statusLine = { type: 'command', command: 'exec relay', padding: 1 } as const
    for (const access of ['read_only', 'workspace_write'] as const) {
      const result = buildPrimarySessionSettings({ access, cliCommand: 'orca', statusLine })
      expect(result.ok).toBe(true)
      if (!result.ok) {
        return
      }
      const { statusLine: written, ...rest } = result.value
      expect(written).toEqual(statusLine)
      expect(rest).toEqual(settingsFor(access))
      expect(Object.keys(result.value).sort()).toEqual([
        'hooks',
        'permissions',
        'statusLine',
        'useAutoModeDuringPlan'
      ])
    }
  })

  it('writes no statusLine key when no relay is given', () => {
    expect(Object.keys(settingsFor('read_only'))).not.toContain('statusLine')
    const result = buildPrimarySessionSettings({
      access: 'read_only',
      cliCommand: 'orca',
      statusLine: null
    })
    expect(result.ok && Object.keys(result.value)).not.toContain('statusLine')
  })

  it('returns a fresh object on every call so a caller cannot change a shared default', () => {
    const first = settingsFor('read_only')
    const second = settingsFor('read_only')
    expect(first).not.toBe(second)
    expect(first.permissions.allow).not.toBe(second.permissions.allow)
  })
})

describe('primarySessionSettingsPath', () => {
  it('places the file under primary-sessions as <run>-g<generation>.json inside user data', () => {
    const result = primarySessionSettingsPath({
      userDataPath: USER_DATA,
      runId: 'run_1',
      generation: 2
    })
    expect(result).toEqual({
      ok: true,
      value: join(USER_DATA, 'primary-sessions', 'run_1-g2.json')
    })
  })

  it.each([
    ['a parent traversal', '..'],
    ['a traversal with a separator', '..\\x'],
    ['a forward slash', 'a/b'],
    ['a backslash', 'a\\b'],
    ['an empty id', ''],
    ['a space', 'run 1'],
    ['a colon', 'C:run'],
    ['a dot only', '.'],
    ['an over-long id', 'r'.repeat(129)]
  ])('refuses a run id with %s', (_label, runId) => {
    const result = primarySessionSettingsPath({ userDataPath: USER_DATA, runId, generation: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_settings_path_invalid')
    }
  })

  it.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'refuses the generation %s',
    (generation) => {
      expect(
        primarySessionSettingsPath({ userDataPath: USER_DATA, runId: 'run_1', generation }).ok
      ).toBe(false)
    }
  )

  it('refuses an empty user data path', () => {
    expect(primarySessionSettingsPath({ userDataPath: '', runId: 'run_1', generation: 1 }).ok).toBe(
      false
    )
  })
})

describe('writePrimarySessionSettingsFile', () => {
  const location = { userDataPath: USER_DATA, runId: 'run_1', generation: 1 }

  it('writes the settings object to the owner-only path through the injected writer', () => {
    const write = vi.fn(() => true)
    const settings = settingsFor('read_only')
    const result = writePrimarySessionSettingsFile({ ...location, settings }, write)
    const expectedPath = join(USER_DATA, 'primary-sessions', 'run_1-g1.json')
    expect(result).toEqual({ ok: true, value: { path: expectedPath } })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(expectedPath, settings)
  })

  it('refuses the launch when the file was written but could not be restricted to the owner', () => {
    const result = writePrimarySessionSettingsFile(
      { ...location, settings: settingsFor('read_only') },
      () => false
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_settings_not_owner_only')
    }
  })

  it('refuses the launch with a write failure code when the writer throws', () => {
    const result = writePrimarySessionSettingsFile(
      { ...location, settings: settingsFor('read_only') },
      () => {
        throw new Error('disk full')
      }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_settings_write_failed')
    }
  })

  it('does not write when the run id is unsafe', () => {
    const write = vi.fn(() => true)
    const result = writePrimarySessionSettingsFile(
      { userDataPath: USER_DATA, runId: '..', generation: 1, settings: settingsFor('read_only') },
      write
    )
    expect(result.ok).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('uses the shared secure JSON writer when no writer is injected', () => {
    secureWrite.mockClear()
    const settings = settingsFor('workspace_write')
    const result = writePrimarySessionSettingsFile({ ...location, settings })
    expect(result.ok).toBe(true)
    expect(secureWrite).toHaveBeenCalledTimes(1)
    expect(secureWrite).toHaveBeenCalledWith(
      join(USER_DATA, 'primary-sessions', 'run_1-g1.json'),
      settings
    )
  })
})

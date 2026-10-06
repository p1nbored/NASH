import { describe, expect, it } from 'vitest'
import {
  buildPrimarySessionArgv,
  checkPrimaryArgvSafety,
  findForbiddenPermissionText,
  resolvePrimaryPermissionMode
} from './primary-session-permission'
import { PRIMARY_SESSION_ACCESS_VALUES } from './primary-session-types'

const SETTINGS_PATH =
  'C:\\Users\\Test User\\AppData\\Roaming\\NASH\\primary-sessions\\run-1-g1.json'
const AGENTS_JSON = '{"autopilot-software_engineering":{"description":"d","prompt":"p"}}'
const NEVER_EMITTED_MODES = ['bypassPermissions', 'auto', 'dontAsk', 'plan', 'default']

describe('resolvePrimaryPermissionMode', () => {
  it('maps read_only to manual and workspace_write to acceptEdits', () => {
    expect(resolvePrimaryPermissionMode('read_only')).toEqual({ ok: true, value: 'manual' })
    expect(resolvePrimaryPermissionMode('workspace_write')).toEqual({
      ok: true,
      value: 'acceptEdits'
    })
  })

  it('covers every access value the app knows and never emits a bypass, auto or dontAsk mode', () => {
    for (const access of PRIMARY_SESSION_ACCESS_VALUES) {
      const result = resolvePrimaryPermissionMode(access)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(NEVER_EMITTED_MODES).not.toContain(result.value)
      }
    }
  })

  it.each([
    ['plan', 'plan'],
    ['bypassPermissions', 'bypassPermissions'],
    ['auto', 'auto'],
    ['dontAsk', 'dontAsk'],
    ['a different case', 'READ_ONLY'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', { access: 'read_only' }]
  ])('refuses %s as an access value', (_label, access) => {
    const result = resolvePrimaryPermissionMode(access)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_posture_invalid')
    }
  })
})

describe('buildPrimarySessionArgv', () => {
  it('builds the permission mode, settings file and agents arguments in a fixed order', () => {
    expect(
      buildPrimarySessionArgv({
        mode: 'manual',
        settingsFilePath: SETTINGS_PATH,
        agentsJson: AGENTS_JSON
      })
    ).toEqual(['--permission-mode', 'manual', '--settings', SETTINGS_PATH, '--agents', AGENTS_JSON])
  })

  it('leaves --agents out when no subagent is defined', () => {
    expect(
      buildPrimarySessionArgv({
        mode: 'acceptEdits',
        settingsFilePath: SETTINGS_PATH,
        agentsJson: null
      })
    ).toEqual(['--permission-mode', 'acceptEdits', '--settings', SETTINGS_PATH])
  })
})

describe('checkPrimaryArgvSafety', () => {
  const valid = [
    '--permission-mode',
    'manual',
    '--settings',
    SETTINGS_PATH,
    '--agents',
    AGENTS_JSON
  ]

  it('accepts exactly the arguments the app builds, with or without model and effort', () => {
    expect(checkPrimaryArgvSafety(valid).ok).toBe(true)
    expect(
      checkPrimaryArgvSafety(['--permission-mode', 'acceptEdits', '--settings', SETTINGS_PATH]).ok
    ).toBe(true)
    expect(
      checkPrimaryArgvSafety([...valid, '--model', 'claude-opus-5-5', '--effort', 'max']).ok
    ).toBe(true)
  })

  it.each([
    ['--dangerously-skip-permissions'],
    ['--allow-dangerously-skip-permissions'],
    ['--dangerously-bypass-approvals-and-sandbox'],
    ['--DANGEROUSLY-SKIP-PERMISSIONS']
  ])('refuses the token %s', (token) => {
    const result = checkPrimaryArgvSafety([...valid, token])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_forbidden_arg')
    }
  })

  it.each([
    ['bypassPermissions'],
    ['auto'],
    ['dontAsk'],
    ['plan'],
    ['default'],
    ['BYPASSPERMISSIONS']
  ])('refuses --permission-mode %s', (mode) => {
    const argv = ['--permission-mode', mode, '--settings', SETTINGS_PATH]
    expect(checkPrimaryArgvSafety(argv).ok).toBe(false)
  })

  it('refuses the equals form of the permission mode flag', () => {
    expect(checkPrimaryArgvSafety(['--permission-mode=auto', '--settings', SETTINGS_PATH]).ok).toBe(
      false
    )
  })

  it('refuses a second --permission-mode flag even when both values are allowed', () => {
    expect(checkPrimaryArgvSafety([...valid, '--permission-mode', 'acceptEdits']).ok).toBe(false)
  })

  it('refuses an argument list with no permission mode at all', () => {
    expect(checkPrimaryArgvSafety(['--settings', SETTINGS_PATH]).ok).toBe(false)
  })

  it('refuses a bypass word hidden inside a value', () => {
    const argv = ['--permission-mode', 'manual', '--settings', 'C:\\bypassPermissions\\s.json']
    expect(checkPrimaryArgvSafety(argv).ok).toBe(false)
  })

  it.each([
    ['--yolo', []],
    ['--allowedTools', ['Bash']],
    ['--add-dir', ['C:\\other']],
    ['--dangerous', []]
  ])('refuses the unexpected flag %s', (flag, values) => {
    const result = checkPrimaryArgvSafety([...valid, flag, ...values])
    expect(result.ok).toBe(false)
  })

  it('refuses a look-alike dash prefix that would slip past a plain text match', () => {
    expect(checkPrimaryArgvSafety([...valid, '\uFF0D\uFF0Ddangerously-skip-permissions']).ok).toBe(
      false
    )
  })

  it('refuses a flag without a value', () => {
    expect(checkPrimaryArgvSafety(['--permission-mode', 'manual', '--settings']).ok).toBe(false)
  })

  it('does not mutate the argument list it checks', () => {
    const argv = Object.freeze([...valid])
    expect(() => checkPrimaryArgvSafety(argv)).not.toThrow()
  })
})

describe('findForbiddenPermissionText', () => {
  it('returns null for a command that carries only the allowed permission modes', () => {
    expect(
      findForbiddenPermissionText(
        "claude '--permission-mode' 'manual' '--settings' 'C:\\a b\\s.json'"
      )
    ).toBeNull()
    expect(findForbiddenPermissionText('claude --permission-mode acceptEdits')).toBeNull()
  })

  it.each([
    ['a dangerously flag', 'claude --dangerously-skip-permissions'],
    ['an allow-dangerously flag', 'claude --allow-dangerously-skip-permissions'],
    ['a bypassPermissions word', 'claude --permission-mode bypassPermissions'],
    ['a dontAsk word', "claude '--permission-mode' 'dontAsk'"],
    ['auto mode in quoted form', "claude '--permission-mode' 'auto'"],
    ['auto mode in equals form', 'claude --permission-mode=auto'],
    ['plan mode', 'claude --permission-mode plan'],
    ['a doubled permission flag', 'claude --permission-mode manual --permission-mode acceptEdits'],
    ['a missing permission flag', "claude '--settings' 'x'"]
  ])('refuses %s', (_label, command) => {
    const refusal = findForbiddenPermissionText(command)
    expect(refusal).not.toBeNull()
    expect(refusal?.code).toBe('autopilot_session_forbidden_arg')
  })
})

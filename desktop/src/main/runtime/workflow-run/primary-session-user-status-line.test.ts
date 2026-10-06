import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveUserStatusLine } from './primary-session-user-status-line'

const WORKSPACE = join('/fixture', 'workspace')
const USER_SETTINGS = join('/fixture', 'home', '.claude', 'settings.json')
const LOCAL = join(WORKSPACE, '.claude', 'settings.local.json')
const PROJECT = join(WORKSPACE, '.claude', 'settings.json')

// FIXTURE_ONLY: the fake value stands in for any secret a real settings file may hold.
const FAKE_SECRET = '0123456789abcdef0123456789abcdef'

function reader(files: Record<string, unknown>) {
  return vi.fn((path: string): string | null => {
    if (!(path in files)) {
      return null
    }
    const value = files[path]
    return typeof value === 'string' ? value : JSON.stringify(value)
  })
}

function resolve(files: Record<string, unknown>) {
  return resolveUserStatusLine({
    workspacePath: WORKSPACE,
    userSettingsPath: USER_SETTINGS,
    read: reader(files)
  })
}

describe('resolveUserStatusLine', () => {
  it("returns the user's own status line from the user settings", () => {
    expect(
      resolve({
        [USER_SETTINGS]: {
          env: { ANTHROPIC_API_KEY: FAKE_SECRET },
          statusLine: { type: 'command', command: 'node C:/hud/index.js', padding: 1 }
        }
      })
    ).toEqual({ command: 'node C:/hud/index.js', padding: 1 })
  })

  it('takes project-local over shared-project over user settings', () => {
    const files = {
      [LOCAL]: { statusLine: { type: 'command', command: 'local-hud' } },
      [PROJECT]: { statusLine: { type: 'command', command: 'project-hud' } },
      [USER_SETTINGS]: { statusLine: { type: 'command', command: 'user-hud' } }
    }
    expect(resolve(files)).toEqual({ command: 'local-hud' })
    expect(resolve({ ...files, [LOCAL]: {} })).toEqual({ command: 'project-hud' })
    expect(resolve({ [USER_SETTINGS]: files[USER_SETTINGS] })).toEqual({ command: 'user-hud' })
  })

  it('reads the three files in precedence order and stops at the first status line', () => {
    const read = reader({ [PROJECT]: { statusLine: { type: 'command', command: 'project-hud' } } })
    resolveUserStatusLine({ workspacePath: WORKSPACE, userSettingsPath: USER_SETTINGS, read })
    expect(read.mock.calls.map(([path]) => path)).toEqual([LOCAL, PROJECT])
  })

  it('returns only the status-line fields and never another key', () => {
    const statusLine = resolve({
      [USER_SETTINGS]: {
        permissions: { allow: ['Bash(*)'] },
        env: { TOKEN: FAKE_SECRET },
        statusLine: {
          type: 'command',
          command: 'hud',
          padding: 0,
          refreshInterval: 10,
          hideVimModeIndicator: true,
          extra: FAKE_SECRET
        }
      }
    })
    expect(statusLine).toEqual({
      command: 'hud',
      padding: 0,
      refreshInterval: 10,
      hideVimModeIndicator: true
    })
    expect(JSON.stringify(statusLine)).not.toContain(FAKE_SECRET)
  })

  it('drops optional fields Claude Code would not accept', () => {
    expect(
      resolve({
        [USER_SETTINGS]: {
          statusLine: {
            type: 'command',
            command: 'hud',
            padding: -1,
            refreshInterval: 0,
            hideVimModeIndicator: 'yes'
          }
        }
      })
    ).toEqual({ command: 'hud' })
  })

  it.each([
    ['no settings files', {}],
    ['no statusLine key', { [USER_SETTINGS]: { theme: 'dark' } }],
    ['malformed JSON', { [USER_SETTINGS]: '{ "statusLine": ' }],
    ['a statusLine that is not an object', { [USER_SETTINGS]: { statusLine: 'hud' } }],
    ['an empty command', { [USER_SETTINGS]: { statusLine: { type: 'command', command: '  ' } } }],
    ['another statusLine type', { [USER_SETTINGS]: { statusLine: { type: 'text', command: 'x' } } }]
  ])('finds no user status line for %s', (_label, files) => {
    expect(resolve(files)).toBeNull()
  })

  it.each([
    [
      'the NASH relay itself',
      `exec "$x" 'C:/NASH/out/cli/statusline-relay/claude-statusline-relay.js' abc`
    ],
    ['an Orca or NASH managed status line', '"${HOME-}/.nash/agent-hooks/claude-statusline.cmd"'],
    [
      'a managed status line with Windows separators',
      'C:\\Users\\me\\.nash\\agent-hooks\\claude-statusline.sh'
    ]
  ])('does not chain %s', (_label, command) => {
    expect(resolve({ [USER_SETTINGS]: { statusLine: { type: 'command', command } } })).toBeNull()
  })
})

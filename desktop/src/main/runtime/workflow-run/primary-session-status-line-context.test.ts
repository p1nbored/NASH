import { describe, expect, it } from 'vitest'
import {
  resolvePrimaryStatusLineRelayContext,
  type StatusLineRelayHostFacts
} from './primary-session-status-line-context'

const RESOURCES = 'C:\\Users\\me\\AppData\\Local\\Programs\\NASH\\resources'
const PACKAGED_RELAY = `${RESOURCES}\\app.asar.unpacked\\out\\cli\\statusline-relay\\claude-statusline-relay.js`
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'

function facts(
  overrides: Partial<StatusLineRelayHostFacts> = {},
  present: readonly string[] = [PACKAGED_RELAY, GIT_BASH]
): StatusLineRelayHostFacts {
  const files = new Set(present.map((path) => path.toLowerCase()))
  return {
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files' },
    isPackaged: true,
    appPath: `${RESOURCES}\\app.asar`,
    resourcesPath: RESOURCES,
    execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\NASH\\NASH.exe',
    homeDir: 'C:\\Users\\me',
    exists: (path) => files.has(path.toLowerCase()),
    ...overrides
  }
}

describe('resolvePrimaryStatusLineRelayContext', () => {
  it('uses the packaged relay, the app runtime and Git Bash on Windows', () => {
    expect(resolvePrimaryStatusLineRelayContext(facts())).toEqual({
      nodeRuntimePath: 'C:\\Users\\me\\AppData\\Local\\Programs\\NASH\\NASH.exe',
      relayScriptPath: PACKAGED_RELAY,
      shellPath: GIT_BASH,
      userSettingsPath: 'C:\\Users\\me\\.claude\\settings.json'
    })
  })

  it('honours CLAUDE_CODE_GIT_BASH_PATH as Claude Code documents it', () => {
    const portable = 'D:\\PortableGit\\bin\\bash.exe'
    const context = resolvePrimaryStatusLineRelayContext(
      facts({ env: { ProgramFiles: 'C:\\Program Files', CLAUDE_CODE_GIT_BASH_PATH: portable } }, [
        PACKAGED_RELAY,
        GIT_BASH,
        portable
      ])
    )
    expect(context?.shellPath).toBe(portable)
  })

  it.each([
    ['a PowerShell path', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    ['cmd.exe', 'C:\\Windows\\System32\\cmd.exe'],
    ['a missing bash', 'E:\\missing\\bin\\bash.exe']
  ])('ignores CLAUDE_CODE_GIT_BASH_PATH set to %s and auto-detects Git Bash', (_label, path) => {
    const context = resolvePrimaryStatusLineRelayContext(
      facts({ env: { ProgramFiles: 'C:\\Program Files', CLAUDE_CODE_GIT_BASH_PATH: path } }, [
        PACKAGED_RELAY,
        GIT_BASH,
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'C:\\Windows\\System32\\cmd.exe'
      ])
    )
    expect(context?.shellPath).toBe(GIT_BASH)
  })

  it('adds no relay on Windows without Git Bash instead of falling back to PowerShell or cmd', () => {
    expect(resolvePrimaryStatusLineRelayContext(facts({}, [PACKAGED_RELAY]))).toBeNull()
  })

  it('adds no relay when the compiled relay script is missing', () => {
    expect(resolvePrimaryStatusLineRelayContext(facts({}, [GIT_BASH]))).toBeNull()
  })

  it('adds no relay for a packaged build without a resources path', () => {
    expect(resolvePrimaryStatusLineRelayContext(facts({ resourcesPath: undefined }))).toBeNull()
  })

  it('uses the CLI output under the app path in a development build', () => {
    const devRelay = 'C:\\src\\orca\\out\\cli\\statusline-relay\\claude-statusline-relay.js'
    const context = resolvePrimaryStatusLineRelayContext(
      facts({ isPackaged: false, appPath: 'C:\\src\\orca' }, [devRelay, GIT_BASH])
    )
    expect(context?.relayScriptPath).toBe(devRelay)
  })

  it("reads the user's settings from CLAUDE_CONFIG_DIR when it is set", () => {
    const context = resolvePrimaryStatusLineRelayContext(
      facts({ env: { ProgramFiles: 'C:\\Program Files', CLAUDE_CONFIG_DIR: 'D:\\claude-work' } })
    )
    expect(context?.userSettingsPath).toBe('D:\\claude-work\\settings.json')
  })

  it('uses /bin/sh on Linux and macOS, as Claude Code runs status-line commands with sh -c', () => {
    const relay =
      '/opt/NASH/resources/app.asar.unpacked/out/cli/statusline-relay/claude-statusline-relay.js'
    const context = resolvePrimaryStatusLineRelayContext({
      platform: 'linux',
      env: {},
      isPackaged: true,
      appPath: '/opt/NASH/resources/app.asar',
      resourcesPath: '/opt/NASH/resources',
      execPath: '/opt/NASH/nash',
      homeDir: '/home/me',
      exists: (path) => path === relay
    })
    expect(context).toEqual({
      nodeRuntimePath: '/opt/NASH/nash',
      relayScriptPath: relay,
      shellPath: '/bin/sh',
      userSettingsPath: '/home/me/.claude/settings.json'
    })
  })
})

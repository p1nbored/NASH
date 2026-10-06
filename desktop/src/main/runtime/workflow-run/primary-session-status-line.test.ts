import { describe, expect, it } from 'vitest'
import {
  CLAUDE_STATUSLINE_RELAY_MAX_ARGUMENT_CHARS,
  decodeClaudeStatusLineRelayRequest
} from '../../../shared/claude-statusline-relay-contract'
import { buildPrimaryStatusLine } from './primary-session-status-line'
import type { PrimaryStatusLineRelayContext } from './primary-session-status-line-context'

const CONTEXT: PrimaryStatusLineRelayContext = {
  nodeRuntimePath: 'C:\\Users\\me\\AppData\\Local\\Programs\\NASH\\NASH.exe',
  relayScriptPath:
    'C:\\Users\\me\\AppData\\Local\\Programs\\NASH\\resources\\app.asar.unpacked\\out\\cli\\statusline-relay\\claude-statusline-relay.js',
  shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
  userSettingsPath: 'C:\\Users\\me\\.claude\\settings.json'
}

function relayArgument(command: string): string {
  return command.split(' ').at(-1) ?? ''
}

describe('buildPrimaryStatusLine', () => {
  it('runs the relay script with the hook node runtime and passes the user command as data', () => {
    const statusLine = buildPrimaryStatusLine(CONTEXT, { command: 'node C:/tools/hud.js' })
    expect(statusLine).not.toBeNull()
    const command = statusLine!.command
    expect(statusLine!.type).toBe('command')
    expect(command).toBe(
      [
        'if [ -n "${ORCA_AGENT_HOOK_NODE-}" ]; then nash_relay_node=$ORCA_AGENT_HOOK_NODE;',
        "else nash_relay_node='C:/Users/me/AppData/Local/Programs/NASH/NASH.exe'; fi;",
        'export ELECTRON_RUN_AS_NODE=1;',
        'exec "$nash_relay_node"',
        "'C:/Users/me/AppData/Local/Programs/NASH/resources/app.asar.unpacked/out/cli/statusline-relay/claude-statusline-relay.js'",
        relayArgument(command)
      ].join(' ')
    )
    expect(decodeClaudeStatusLineRelayRequest(relayArgument(command))).toEqual({
      shell: CONTEXT.shellPath,
      command: 'node C:/tools/hud.js'
    })
  })

  it('never names cmd.exe, PowerShell or a script launcher in the command', () => {
    const command = buildPrimaryStatusLine(CONTEXT, { command: 'hud' })!.command
    expect(command).not.toMatch(/cmd\.exe|powershell|pwsh|\.cmd\b|\.bat\b|\.ps1\b/i)
  })

  it('keeps the user command out of the visible command line', () => {
    const command = buildPrimaryStatusLine(CONTEXT, {
      command: 'my-secret-looking-hud --x'
    })!.command
    expect(command).not.toContain('my-secret-looking-hud')
  })

  it("carries the user's padding, refresh interval and vim indicator choice", () => {
    expect(
      buildPrimaryStatusLine(CONTEXT, {
        command: 'hud',
        padding: 2,
        refreshInterval: 5,
        hideVimModeIndicator: true
      })
    ).toMatchObject({ padding: 2, refreshInterval: 5, hideVimModeIndicator: true })
  })

  it('still relays usage when the user has no status line, and passes no command', () => {
    const statusLine = buildPrimaryStatusLine(CONTEXT, null)
    expect(Object.keys(statusLine!).sort()).toEqual(['command', 'type'])
    expect(decodeClaudeStatusLineRelayRequest(relayArgument(statusLine!.command))).toEqual({
      shell: CONTEXT.shellPath,
      command: null
    })
  })

  it('quotes a path that holds a single quote', () => {
    const statusLine = buildPrimaryStatusLine(
      { ...CONTEXT, relayScriptPath: "C:\\Users\\o'neil\\relay.js" },
      null
    )
    expect(statusLine!.command).toContain("'C:/Users/o'\\''neil/relay.js'")
  })

  it('keeps a POSIX path as it is', () => {
    const statusLine = buildPrimaryStatusLine(
      {
        nodeRuntimePath: '/Applications/NASH.app/Contents/MacOS/NASH',
        relayScriptPath: '/Applications/NASH.app/Contents/Resources/relay.js',
        shellPath: '/bin/sh',
        userSettingsPath: '/Users/me/.claude/settings.json'
      },
      null
    )
    expect(statusLine!.command).toContain("'/Applications/NASH.app/Contents/MacOS/NASH'")
    expect(statusLine!.command).toContain("'/Applications/NASH.app/Contents/Resources/relay.js'")
  })

  it('adds no relay when the user command would not fit on a command line', () => {
    const command = 'x'.repeat(CLAUDE_STATUSLINE_RELAY_MAX_ARGUMENT_CHARS)
    expect(buildPrimaryStatusLine(CONTEXT, { command })).toBeNull()
  })
})

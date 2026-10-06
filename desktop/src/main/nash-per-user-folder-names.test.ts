import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getUserKeybindingsPath } from './keybindings/keybinding-file'
import {
  createManagedCommandMatcher,
  getSharedManagedScriptPath
} from './agent-hooks/installer-utils'
import { wrapRuntimeHomeHookCommand } from './agent-hooks/runtime-home-hook-command'
import { buildCodexHookCommand } from './codex/codex-hook-command-form'
import { getDshRemoteManagedHooksPath } from './dsh/hook-settings'
import { getMuseRemoteManagedHooksPath } from './muse/hook-settings'
import { getSharedJcodeScriptPath, isJcodeManagedCommand } from './jcode/hook-settings'
import { RELAY_REMOTE_DIR } from './ssh/relay-protocol'
import { SHORT_RELAY_SOCKET_DIR_PREFIX } from './ssh/relay-socket-path-limit'
import { getDefaultWorkspaceDir } from '../shared/constants'
import { WSL_BROWSER_NETWORK_RELAY_DIR } from '../shared/wsl-browser-network-relay-contract'
import { WSL_HOOK_RELAY_DIR, wslHookRelayEndpointDir } from '../shared/wsl-hook-relay-contract'

// FIXTURE_ONLY: command shapes a real Orca install writes into shared agent configs (decision D-017).
const ORCA_POSIX_HOOK = '/bin/sh -c ". /home/me/.orca/agent-hooks/claude-hook.sh"'
const ORCA_WINDOWS_HOOK = 'C:\\Users\\me\\.orca\\agent-hooks\\claude-hook.cmd'
const NASH_POSIX_HOOK = '/bin/sh -c ". /home/me/.nash/agent-hooks/claude-hook.sh"'
const NASH_WINDOWS_HOOK = 'C:\\Users\\me\\.nash\\agent-hooks\\claude-hook.cmd'

function decodeEncodedPowerShell(command: string): string {
  const encoded = /-EncodedCommand\s+(\S+)/.exec(command)?.[1] ?? ''
  return Buffer.from(encoded, 'base64').toString('utf16le')
}

describe('agent hook script folder', () => {
  it('keeps the shared hook script under ~/.nash/agent-hooks', () => {
    expect(getSharedManagedScriptPath('claude-hook.sh')).toBe(
      join(homedir(), '.nash', 'agent-hooks', 'claude-hook.sh')
    )
    expect(getSharedJcodeScriptPath('jcode-hook.sh')).toBe(
      join(homedir(), '.nash', 'agent-hooks', 'jcode-hook.sh')
    )
  })

  it('recognises only its own hook entries in a shared agent config', () => {
    const isManaged = createManagedCommandMatcher('claude-hook.sh')

    expect(isManaged(NASH_POSIX_HOOK)).toBe(true)
    expect(isManaged(NASH_WINDOWS_HOOK)).toBe(true)
    expect(isManaged(ORCA_POSIX_HOOK)).toBe(false)
    expect(isManaged(ORCA_WINDOWS_HOOK)).toBe(false)
    expect(isManaged('/opt/agent-hooks/claude-hook.sh')).toBe(false)
  })

  it('recognises its own PowerShell-encoded entry but not a real Orca one', () => {
    const isManaged = createManagedCommandMatcher('claude-hook.cmd')
    const encode = (script: string): string =>
      `powershell.exe -NoProfile -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`

    expect(isManaged(encode('& C:\\Users\\me\\.nash\\agent-hooks\\claude-hook.cmd'))).toBe(true)
    expect(isManaged(encode('& C:\\Users\\me\\.orca\\agent-hooks\\claude-hook.cmd'))).toBe(false)
  })

  it('matches a jcode hook only under its own folder', () => {
    expect(isJcodeManagedCommand("'/home/me/.nash/agent-hooks/jcode-hook.sh'")).toBe(true)
    expect(isJcodeManagedCommand("'C:\\Users\\me\\.nash\\agent-hooks\\jcode-hook.cmd'")).toBe(true)
    expect(isJcodeManagedCommand("'/home/me/.orca/agent-hooks/jcode-hook.sh'")).toBe(false)
  })

  it('points the runtime-home hook command at ~/.nash/agent-hooks on every shell form', () => {
    const command = wrapRuntimeHomeHookCommand('claude-hook')
    const powershell = decodeEncodedPowerShell(command)

    expect(command).toContain('${HOME-}/.nash/agent-hooks/claude-hook.sh')
    expect(command).toContain('${HOME-}/.nash/agent-hooks/claude-hook.cmd')
    expect(powershell).toContain('.nash\\agent-hooks\\claude-hook.cmd')
    expect(command + powershell).not.toContain('.orca')
  })

  it('points the frozen Codex command at ~/.nash/agent-hooks', () => {
    const posix = buildCodexHookCommand('/home/me/.nash/agent-hooks/codex-hook.sh', 'linux')

    expect(posix).toContain('${HOME-}/.nash/agent-hooks/codex-hook.sh')
    expect(posix).not.toContain('.orca/')
  })

  it('builds remote hook script paths under the remote ~/.nash folder', () => {
    expect(getMuseRemoteManagedHooksPath('/home/me/')).toMatch(/^\/home\/me\/\.nash\/agent-hooks\//)
    expect(getDshRemoteManagedHooksPath('/home/me/')).toMatch(/^\/home\/me\/\.nash\/agent-hooks\//)
  })
})

describe('other per-user app files', () => {
  it('keeps the keybinding file under ~/.nash', () => {
    expect(getUserKeybindingsPath('/home/me')).toBe(join('/home/me', '.nash', 'keybindings.json'))
  })

  it('keeps remote relay folders under NASH names', () => {
    expect(RELAY_REMOTE_DIR).toBe('.nash-remote')
    expect(SHORT_RELAY_SOCKET_DIR_PREFIX).toBe('/tmp/.nash-relay-')
  })

  it('keeps WSL relay folders under NASH names', () => {
    expect(WSL_HOOK_RELAY_DIR).toBe('.nash-wsl/hook-relay')
    expect(WSL_BROWSER_NETWORK_RELAY_DIR).toBe('.nash-wsl/browser-network')
    expect(wslHookRelayEndpointDir('/home/me/', 'instance-1')).toBe(
      '/home/me/.nash-wsl/agent-hooks/instance-instance-1'
    )
  })

  it('defaults the workspace root to ~/nash/workspaces', () => {
    expect(getDefaultWorkspaceDir('/home/me/')).toBe('/home/me/nash/workspaces')
    expect(getDefaultWorkspaceDir('C:\\Users\\me')).toBe('C:\\Users\\me\\nash\\workspaces')
  })
})

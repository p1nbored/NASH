import { join } from 'node:path'
import { APP_AGENT_HOOKS_HOME_PATH } from '../../../shared/app-identity-paths'
import {
  WINDOWS_CMD_SAFE_PATH,
  wrapPosixHookCommand,
  wrapWindowsHookCommand,
  writeManagedScript
} from '../../agent-hooks/installer-utils'
import { quotePosixShellString } from '../../agent-hooks/posix-hook-command'
import { getWindowsSystem32Path } from '../../agent-hooks/windows-powershell-hook-launcher'

export type PermissionHookProvider = 'claude' | 'codex' | 'agy'
const AGY_FALLBACK = '{"decision":"ask"}'

function scriptPath(
  provider: PermissionHookProvider,
  home: string,
  platform: NodeJS.Platform
): string {
  return join(
    home,
    APP_AGENT_HOOKS_HOME_PATH,
    `nash-permission-${provider}.${platform === 'win32' ? 'cmd' : 'sh'}`
  )
}

export function getPermissionHookCommand(
  provider: PermissionHookProvider,
  home: string,
  platform: NodeJS.Platform = process.platform
): string {
  const path = scriptPath(provider, home, platform)
  const fallbackStdout = provider === 'agy' ? AGY_FALLBACK : undefined
  if (platform === 'win32') {
    const cmd = getWindowsSystem32Path('cmd.exe').replaceAll('/', '\\')
    if (WINDOWS_CMD_SAFE_PATH.test(path) && WINDOWS_CMD_SAFE_PATH.test(cmd)) {
      const fallback = fallbackStdout ? `echo ${fallbackStdout}` : 'exit /b 0'
      return `${cmd} /d /v:off /s /c ${quotePosixShellString(`if exist ${path} (call ${path}) else (${fallback})`)}`
    }
    return wrapWindowsHookCommand(path, {}, { fallbackStdout })
  }
  return `/bin/sh -c ${quotePosixShellString(wrapPosixHookCommand(path, {}, { fallbackStdout }))}`
}

export function permissionHookScript(
  provider: PermissionHookProvider,
  platform: NodeJS.Platform
): string {
  if (platform === 'win32') {
    return [
      '@echo off',
      'setlocal DisableDelayedExpansion',
      'if not defined ORCA_PANE_KEY goto fallback',
      'if not defined ORCA_CLI_COMMAND goto fallback',
      'if not exist "%ORCA_CLI_COMMAND%" goto fallback',
      'set "NASH_PERMISSION_OUTPUT="',
      `for /f "delims=" %%R in ('call "%ORCA_CLI_COMMAND%" orchestration permission-request --provider ${provider} 2^>nul') do (`,
      '  echo(%%R',
      '  set "NASH_PERMISSION_OUTPUT=1"',
      ')',
      'if defined NASH_PERMISSION_OUTPUT exit /b 0',
      ':fallback',
      ...(provider === 'agy' ? [`echo ${AGY_FALLBACK}`] : []),
      'exit /b 0',
      ''
    ].join('\r\n')
  }
  return [
    '#!/bin/sh',
    'if [ -n "${ORCA_PANE_KEY:-}" ] && [ -n "${ORCA_CLI_COMMAND:-}" ] && [ -x "$ORCA_CLI_COMMAND" ]; then',
    `  output=$("$ORCA_CLI_COMMAND" orchestration permission-request --provider ${provider} 2>/dev/null)`,
    '  if [ -n "$output" ]; then printf \'%s\\n\' "$output"; exit 0; fi',
    'fi',
    ...(provider === 'agy' ? [`printf '%s\\n' '${AGY_FALLBACK}'`] : []),
    'exit 0',
    ''
  ].join('\n')
}

export function installPermissionHookScript(provider: PermissionHookProvider, home: string): void {
  writeManagedScript(
    scriptPath(provider, home, process.platform),
    permissionHookScript(provider, process.platform)
  )
}

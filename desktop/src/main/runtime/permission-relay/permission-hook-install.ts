import { homedir } from 'node:os'
import { join } from 'node:path'
import { isPlainObject, readHooksJsonWithRaw } from '../../agent-hooks/hooks-json-read'
import { writeHooksJson, type HooksConfig } from '../../agent-hooks/installer-utils'
import {
  isCliCommandName,
  PERMISSION_HOOK_TIMEOUT_SECONDS
} from '../../../shared/workflow-run/autopilot-cli-commands'
import { getClaudeProfileRouter } from '../../claude-accounts/claude-profile-installed-router'
import {
  readUserClaudeConfigDir,
  resolveClaudeDefaultHome
} from '../../claude-accounts/claude-profile-paths'
import { getPermissionHookCommand, installPermissionHookScript } from './permission-hook-command'

type Provider = 'claude' | 'codex' | 'agy'
const BUNDLE = 'nash-permission-relay'

type InstallFailureCode =
  | 'profile_unavailable'
  | 'config_unreadable'
  | 'config_invalid'
  | 'config_changed'
  | 'write_failed'

export type PermissionHookInstallResult = {
  installed: Provider[]
  failures: { provider: Provider; code: InstallFailureCode }[]
}

/** Permission gates are independent of managed status hooks, which remain Claude-only. */
export function permissionHookConfig(
  config: Record<string, unknown>,
  provider: Provider,
  cliCommand: string,
  hookCommand = `${cliCommand} orchestration permission-request --provider ${provider}`
): HooksConfig {
  if (!isCliCommandName(cliCommand)) {
    throw new Error('Invalid permission hook CLI name.')
  }
  const key = provider === 'agy' ? BUNDLE : 'hooks'
  const existing = config[key]
  if (existing !== undefined && !isPlainObject(existing)) {
    throw new Error('Invalid permission hook configuration.')
  }
  const events = existing ?? {}
  const event = provider === 'agy' ? 'PreToolUse' : 'PermissionRequest'
  const definitions = events[event]
  if (definitions !== undefined && !Array.isArray(definitions)) {
    throw new Error('Invalid permission hook event.')
  }
  const command = hookCommand
  const preserved = (definitions ?? []).flatMap((definition: unknown) => {
    if (!isPlainObject(definition) || !Array.isArray(definition.hooks)) {
      throw new Error('Invalid permission hook handler.')
    }
    const hooks = definition.hooks.filter(
      (hook: unknown) =>
        !isPlainObject(hook) ||
        typeof hook.command !== 'string' ||
        (hook.command !== command &&
          !hook.command.includes(`/nash-permission-${provider}.`) &&
          !hook.command.includes(`\\nash-permission-${provider}.`) &&
          !/^[A-Za-z][A-Za-z0-9_-]* orchestration permission-request(?: --provider (?:claude|codex|agy))?$/.test(
            hook.command
          ))
    )
    return hooks.length ? [{ ...definition, hooks }] : []
  })
  return {
    ...config,
    [key]: {
      ...events,
      [event]: [
        ...preserved,
        {
          matcher: '*',
          hooks: [{ type: 'command', command, timeout: PERMISSION_HOOK_TIMEOUT_SECONDS }]
        }
      ]
    }
  }
}

/** Run on the execution host. No trust grants or user permission rules are changed. */
export function installPermissionHooks(
  cliCommand: string,
  home = homedir()
): PermissionHookInstallResult {
  if (!isCliCommandName(cliCommand)) {
    throw new Error('Invalid permission hook CLI name.')
  }
  const installed = new Set<Provider>()
  const failures: PermissionHookInstallResult['failures'] = []
  const targets: [Provider, string][] = []
  try {
    const router = getClaudeProfileRouter()
    const selectedHome = router?.selectedHome()
    const claudeHomes = new Set([
      router?.systemDefaultHome() ??
        resolveClaudeDefaultHome(home, readUserClaudeConfigDir(process.env)),
      ...(router?.accountHomes() ?? []),
      ...(selectedHome ? [selectedHome] : [])
    ])
    for (const configHome of claudeHomes) {
      targets.push(['claude', join(configHome, 'settings.json')])
    }
  } catch {
    failures.push({ provider: 'claude', code: 'profile_unavailable' })
  }
  targets.push(
    ['codex', join(home, '.codex', 'hooks.json')],
    ['agy', join(home, '.gemini', 'config', 'hooks.json')]
  )
  for (const [provider, path] of targets) {
    const before = readHooksJsonWithRaw(path)
    if (!before.config) {
      failures.push({ provider, code: 'config_unreadable' })
      continue
    }
    let next: HooksConfig
    try {
      next = permissionHookConfig(
        before.config,
        provider,
        cliCommand,
        getPermissionHookCommand(provider, home)
      )
    } catch {
      failures.push({ provider, code: 'config_invalid' })
      continue
    }
    try {
      installPermissionHookScript(provider, home)
    } catch {
      failures.push({ provider, code: 'write_failed' })
      continue
    }
    if (JSON.stringify(next) !== JSON.stringify(before.config)) {
      const current = readHooksJsonWithRaw(path)
      if (!current.config) {
        failures.push({ provider, code: 'config_unreadable' })
        continue
      }
      if (current.raw !== before.raw) {
        failures.push({ provider, code: 'config_changed' })
        continue
      }
      try {
        writeHooksJson(path, next)
      } catch {
        failures.push({ provider, code: 'write_failed' })
        continue
      }
    }
    installed.add(provider)
  }
  return { installed: [...installed], failures }
}

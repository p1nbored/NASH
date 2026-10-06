import { join } from 'node:path'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { resolveLocalAccountRuntimeTarget } from '../../shared/local-account-runtime'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { getDefaultWslDistro, getWslHome } from '../wsl'
import { ClaudeRuntimePathResolver } from './runtime-paths'
import {
  normalizeClaudeAccountSelectionTarget,
  type ClaudeAccountSelectionTarget
} from './runtime-selection'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'

export type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'

type ClaudeRuntimeSettingsSource = {
  getSettings(): Pick<
    GlobalSettings,
    'localAccountRuntime' | 'localAccountWslDistro' | 'localWindowsRuntimeDefault'
  >
}

/**
 * Where a Claude launch finds its login. Claude Code runs only on the user's own login (account
 * switching was removed, user decision 2026-10-06): the default ~/.claude or an inherited
 * CLAUDE_CONFIG_DIR on the host, the distro's own ~/.claude under WSL. Nothing here writes a
 * credential, an oauthAccount or a Keychain item, or renews a token.
 */
export class ClaudeRuntimeAuthService {
  private readonly pathResolver = new ClaudeRuntimePathResolver()

  constructor(private readonly settings: ClaudeRuntimeSettingsSource) {}

  getPreparation(target?: ClaudeAccountSelectionTarget): ClaudeRuntimeAuthPreparation {
    const resolved = normalizeClaudeAccountSelectionTarget(
      this.resolveWslDefaultTarget(target ?? this.getDefaultTarget())
    )
    const paths = this.pathResolver.getRuntimePaths()
    if (resolved.runtime === 'wsl') {
      return this.getWslSystemPreparation(resolved.wslDistro, paths.configDir)
    }
    // Why stripAuthEnv false: with no managed account the user's own ANTHROPIC_* is their sign-in.
    return {
      configDir: paths.configDir,
      runtime: 'host',
      wslDistro: null,
      wslLinuxConfigDir: null,
      envPatch: paths.envPatch,
      stripAuthEnv: false,
      provenance: 'system'
    }
  }

  async prepareForClaudeLaunch(
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRuntimeAuthPreparation> {
    return this.getPreparation(target)
  }

  async prepareForRateLimitFetch(
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRuntimeAuthPreparation> {
    return this.getPreparation(target)
  }

  getRuntimeConfigDir(target?: ClaudeAccountSelectionTarget): string {
    return this.getPreparation(target).configDir
  }

  private getWslSystemPreparation(
    wslDistro: string | null,
    hostConfigDir: string
  ): ClaudeRuntimeAuthPreparation {
    const distro = wslDistro ?? getDefaultWslDistro()
    const wslHome = distro ? getWslHome(distro) : null
    const wslHomeInfo = wslHome ? parseWslUncPath(wslHome) : null
    if (distro && wslHome && wslHomeInfo) {
      return {
        configDir: join(wslHome, '.claude'),
        runtime: 'wsl',
        wslDistro: distro,
        wslLinuxConfigDir: `${wslHomeInfo.linuxPath.replace(/\/$/, '')}/.claude`,
        envPatch: {},
        stripAuthEnv: true,
        provenance: `wsl:${distro}:system`
      }
    }
    return {
      configDir: hostConfigDir,
      runtime: 'wsl',
      wslDistro,
      wslLinuxConfigDir: null,
      envPatch: {},
      stripAuthEnv: true,
      provenance: `wsl:${wslDistro ?? '__default__'}:system`
    }
  }

  private getDefaultTarget(): ClaudeAccountSelectionTarget {
    // Why: Windows auth follows the resolved account runtime; stale cross-platform WSL pins must stay local-host.
    const resolved = resolveLocalAccountRuntimeTarget(this.settings.getSettings())
    if (process.platform === 'win32' && resolved.runtime === 'wsl') {
      return { runtime: 'wsl', wslDistro: resolved.wslDistro }
    }
    return { runtime: 'host' }
  }

  private resolveWslDefaultTarget(
    target: ClaudeAccountSelectionTarget
  ): ClaudeAccountSelectionTarget {
    if (target.runtime !== 'wsl' || target.wslDistro?.trim()) {
      return target
    }
    const defaultDistro = getDefaultWslDistro()
    return defaultDistro ? { runtime: 'wsl', wslDistro: defaultDistro } : target
  }
}

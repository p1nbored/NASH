import { withClaudeProfileTerminalEnv } from '../../../claude-accounts/claude-profile-installed-router'
import { inheritOmpLaunchEnvironment } from '../host-env/omp-launch-environment'
import { getAppEnvironment } from '../../../../shared/app-environment'
import type { PtySpawnResult } from '../../../providers/pty-provider-contract'
import { LocalPtyProvider } from '../../../providers/local-pty-provider'
import { isValidTerminalTabId } from '../../../../shared/terminal-tab-id'
import { isTerminalLeafId } from '../../../../shared/stable-pane-id'
import { getProvider } from '../provider/registry'
import { buildPtyHostEnv } from '../host-env/assembly'
import {
  getCompatibleSelectedCodexHomePath,
  getCodexSelectionTargetForPty,
  resolveCodexHomeAfterManagedAuthReadiness,
  shouldSkipCodexHomeEnvForWindowsShell,
  shouldStripInheritedOrcaCodexHome,
  codexHomePathsEqual
} from '../host-env/codex-home'
import { promoteAgentTeamsShimPath } from '../host-env/path'
import {
  isClaudeLaunchCommand,
  recoverFreshSpawnProviderRouting,
  routesFreshSpawnsToLocalProvider
} from '../host-env/fresh-spawn-routing'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import {
  isSafePtySessionId,
  mintPtySessionId,
  ptySessionIdForAgentCreateOperation
} from '../../../daemon/pty-session-id'
import { resolveWslSessionContext } from '../../../daemon/wsl-session-context'
import { isAgentStatusHooksEnabled } from '../../../agent-hooks/managed-agent-hook-controls'
import { resolvePlainTerminalPtyOptions } from '../../../local-project-runtime-resolution'
import { resolvePathEnvKey } from '../../../pty/windows-environment-path'
import { stampWslOrchestrationCompatibilityHost } from '../../../pty/wsl-orca-env'
import { stampRuntimeSourceEnv } from '../../../../shared/runtime-source-env'
import { getRuntimeSourceStamp } from '../../../runtime/host-descriptor'
import { ensureCodexStateDbBackfillRecoveryStarted } from '../../../codex/codex-state-db-backfill-recovery'
import { clearProviderPtyState } from '../provider/state-cleanup'
import { awaitExplicitPiOmpGuestReadiness } from '../../../agent-hooks/wsl-pi-omp-guest-readiness'
import type { RuntimePtySpawnState } from './spawn-state'
import { getConnectionExecutionHostId } from '../../../../shared/execution-host'

export async function prepareRuntimePtySpawn(
  ctx: RuntimePtySpawnState
): Promise<PtySpawnResult | null> {
  const args = ctx.args
  if (!ctx.preAdoptedStablePane) {
    const pathUsable = ctx.deps.assertFolderWorkspacePtyPathUsable(args.worktreeId)
    if (pathUsable) {
      await pathUsable
    }
  }
  ctx.cwd = ctx.deps.resolvePtySpawnStartupCwd(args.worktreeId, args.cwd)
  // Only this machine spawns here: an `ssh:` connection throws, so every line below is local.
  ctx.provider = getProvider(getConnectionExecutionHostId(args.connectionId))
  const freshSpawnRecovery = ctx.preAdoptedStablePane
    ? undefined
    : recoverFreshSpawnProviderRouting(ctx.provider, args.sessionId, args.isNewSession)
  if (freshSpawnRecovery) {
    await freshSpawnRecovery
  }
  ctx.isClaudeLaunch = !ctx.preAdoptedStablePane && isClaudeLaunchCommand(args.command)
  // Why: runtime-created terminals carry no renderer projectRuntime. An agent launch brings the PTY
  // its command was quoted for; anything else takes the project's runtime and `--shell` pick.
  ctx.terminalRuntimeOptions =
    args.launchRuntime?.pty ??
    resolvePlainTerminalPtyOptions(
      ctx.deps.store,
      ctx.deps.getSettings?.(),
      args.worktreeId,
      args.shellOverride
    )
  ctx.daemonShellOverride = ctx.terminalRuntimeOptions.shellOverride
  ctx.isDaemonHostSpawn =
    !(ctx.provider instanceof LocalPtyProvider) && !routesFreshSpawnsToLocalProvider(ctx.provider)
  ctx.callerRequestedSessionId = args.sessionId?.trim()
  ctx.requestedSessionId =
    ctx.callerRequestedSessionId ??
    (ctx.isDaemonHostSpawn && args.agentSessionCreateOperationId
      ? ptySessionIdForAgentCreateOperation(args.worktreeId, args.agentSessionCreateOperationId)
      : undefined)
  ctx.sessionId =
    ctx.requestedSessionId ??
    (ctx.isDaemonHostSpawn ? mintPtySessionId(args.worktreeId) : undefined)
  ctx.effectiveSessionAppId = ctx.sessionId
  ctx.isNewDaemonSession =
    !ctx.preAdoptedStablePane &&
    ctx.isDaemonHostSpawn &&
    (ctx.callerRequestedSessionId === undefined || args.isNewSession === true)
  ctx.expectedWslDistro =
    resolveWslSessionContext({
      cwd: ctx.cwd,
      sessionId: ctx.sessionId,
      shellOverride: ctx.terminalRuntimeOptions.shellOverride,
      terminalWindowsWslDistro: ctx.terminalRuntimeOptions.terminalWindowsWslDistro
    })?.distro ?? null
  ctx.codexSelectionTarget = getCodexSelectionTargetForPty(
    ctx.daemonShellOverride,
    ctx.cwd,
    ctx.expectedWslDistro
  )
  const codexResumePreparation = ctx.preAdoptedStablePane
    ? null
    : ctx.deps.prepareCodexResumeHome({
        connectionId: args.connectionId,
        launchAgent: args.launchAgent,
        providerSession: args.resumeProviderSession,
        target: ctx.codexSelectionTarget,
        launchEnv: args.env
      })
  const codexResumeLaunch = codexResumePreparation
    ? await ctx.deps.resolveCodexResumeLaunch(args.command, codexResumePreparation)
    : ctx.deps.noCodexResumeLaunch(ctx.preAdoptedStablePane ? undefined : args.command)
  const codexResumeHome = codexResumeLaunch.codexResumeHome
  // Why: the drop still applies here, but this controller's result has no field for
  // notifyResumeUnavailable — runtime/relay panes start fresh without the notice.
  ctx.launchCommand = codexResumeLaunch.command
  args.env = withClaudeProfileTerminalEnv(args.env, ctx.codexSelectionTarget)
  ctx.claudeAuth =
    ctx.isClaudeLaunch && ctx.deps.prepareClaudeAuth
      ? await ctx.deps.prepareClaudeAuth(ctx.codexSelectionTarget)
      : null

  ctx.shouldPersistHostSessionBinding = args.persistHostSessionBinding === true
  if (ctx.shouldPersistHostSessionBinding) {
    if (
      !ctx.deps.store ||
      typeof args.worktreeId !== 'string' ||
      typeof args.tabId !== 'string' ||
      !isValidTerminalTabId(args.tabId) ||
      typeof args.leafId !== 'string' ||
      !isTerminalLeafId(args.leafId)
    ) {
      throw new Error('Cannot persist runtime PTY binding without worktreeId, tabId, and leafId')
    }
    ctx.hostSessionBinding = {
      store: ctx.deps.store,
      worktreeId: args.worktreeId,
      tabId: args.tabId,
      leafId: args.leafId,
      ...(args.expectedSourceBinding ? { expectedSourceBinding: args.expectedSourceBinding } : {}),
      ...(args.placement ? { placement: args.placement } : {})
    }
  }
  ctx.env = ctx.claudeAuth ? { ...args.env, ...ctx.claudeAuth.envPatch } : args.env
  ctx.requestedAgentTeamsPath = ctx.env?.ORCA_AGENT_TEAMS_TEAM_ID
    ? ctx.env[resolvePathEnvKey(ctx.env, process.platform)]
    : undefined
  ctx.env = ctx.deps.stripSequencedStartupResumeArgv(ctx.env, codexResumeLaunch)
  if (args.preAllocatedHandle) {
    ctx.env = { ...ctx.env, ORCA_TERMINAL_HANDLE: args.preAllocatedHandle }
  }
  const launchesCodex = args.launchAgent === 'codex'
  const selectLaunchCodexHome = async (): Promise<string | null> =>
    (await ctx.deps.getSelectedCodexHomePath?.(ctx.codexSelectionTarget, ctx.env, {
      launchesCodex
    })) ?? null
  ctx.selectedCodexHomePath = !ctx.preAdoptedStablePane
    ? getCompatibleSelectedCodexHomePath(
        ctx.codexSelectionTarget,
        codexResumeHome
          ? await ctx.deps.reconcileSharedRuntimeResumeHome(codexResumeHome, async () =>
              getCompatibleSelectedCodexHomePath(
                ctx.codexSelectionTarget,
                await selectLaunchCodexHome()
              )
            )
          : await selectLaunchCodexHome()
      )
    : null
  if (
    !ctx.preAdoptedStablePane &&
    args.launchAgent === 'codex' &&
    ctx.callerRequestedSessionId === undefined
  ) {
    const resolution = resolveCodexHomeAfterManagedAuthReadiness({
      selectedCodexHomePath: ctx.selectedCodexHomePath,
      getSettings: () => ctx.deps.getSettings?.(),
      requiredCodexHomePath: codexResumeHome?.codexHomePath,
      target: ctx.codexSelectionTarget,
      resolveCurrent: async () =>
        getCompatibleSelectedCodexHomePath(
          ctx.codexSelectionTarget,
          (await ctx.deps.getSelectedCodexHomePath?.(ctx.codexSelectionTarget, ctx.env, {
            launchesCodex
          })) ?? null
        ),
      resolveAfterUnavailable: async (unavailableManagedHomePath) =>
        getCompatibleSelectedCodexHomePath(
          ctx.codexSelectionTarget,
          (await ctx.deps.getSelectedCodexHomePath?.(ctx.codexSelectionTarget, ctx.env, {
            unavailableManagedHomePath,
            launchesCodex
          })) ?? null
        )
    })
    ctx.selectedCodexHomePath = resolution instanceof Promise ? await resolution : resolution
  }
  if (args.launchAgent === 'codex' && ctx.selectedCodexHomePath) {
    await ensureCodexStateDbBackfillRecoveryStarted(ctx.selectedCodexHomePath)
  }
  ctx.codexResumeHomeSelected = Boolean(
    codexResumeHome && codexHomePathsEqual(ctx.selectedCodexHomePath, codexResumeHome.codexHomePath)
  )
  ctx.skipCodexHomeEnv =
    ctx.isDaemonHostSpawn &&
    shouldSkipCodexHomeEnvForWindowsShell(ctx.daemonShellOverride, ctx.cwd) &&
    !ctx.selectedCodexHomePath
  const ptySettings = ctx.isDaemonHostSpawn ? ctx.deps.getSettings?.() : undefined
  ctx.stripInheritedOrcaCodexHome =
    ctx.isDaemonHostSpawn &&
    shouldStripInheritedOrcaCodexHome({
      target: ctx.codexSelectionTarget,
      selectedCodexHomePath: ctx.selectedCodexHomePath,
      skipCodexHomeEnv: ctx.skipCodexHomeEnv,
      settings: ptySettings
    })
  if (ctx.isDaemonHostSpawn && ctx.sessionId && !ctx.preAdoptedStablePane) {
    if (!isSafePtySessionId(ctx.sessionId, getAppEnvironment().getPath('userData'))) {
      throw new Error('Invalid PTY session id')
    }
    try {
      ctx.env ??= {}
      await inheritOmpLaunchEnvironment(ctx.env, {
        isWsl: shouldSkipCodexHomeEnvForWindowsShell(ctx.daemonShellOverride, ctx.cwd),
        launchAgent: args.launchAgent,
        launchCommand: ctx.launchCommand
      })
      await awaitExplicitPiOmpGuestReadiness({
        isWsl: shouldSkipCodexHomeEnvForWindowsShell(ctx.daemonShellOverride, ctx.cwd),
        distro: ctx.codexSelectionTarget.runtime === 'wsl' ? ctx.expectedWslDistro : null,
        codexHomePath: ctx.selectedCodexHomePath,
        launchAgent: isTuiAgent(args.launchAgent) ? args.launchAgent : undefined,
        launchCommand: ctx.launchCommand
      })
      ctx.env = buildPtyHostEnv(ctx.sessionId, ctx.env ?? {}, {
        isPackaged: getAppEnvironment().isPackaged(),
        resourcesPath: process.resourcesPath,
        userDataPath: getAppEnvironment().getPath('userData'),
        selectedCodexHomePath: ctx.selectedCodexHomePath,
        skipCodexHomeEnv: ctx.skipCodexHomeEnv,
        stripInheritedOrcaCodexHome: ctx.stripInheritedOrcaCodexHome,
        launchCommand: ctx.launchCommand,
        launchAgent: isTuiAgent(args.launchAgent) ? args.launchAgent : undefined,
        shellPath: ctx.daemonShellOverride,
        isWsl: shouldSkipCodexHomeEnvForWindowsShell(ctx.daemonShellOverride, ctx.cwd),
        wslDistro: ctx.codexSelectionTarget.runtime === 'wsl' ? ctx.expectedWslDistro : null,
        agentStatusHooksEnabled: isAgentStatusHooksEnabled(ptySettings),
        disabledTuiAgents: ptySettings?.disabledTuiAgents,
        networkProxySettings: ptySettings,
        routeBrowserOpensToClient: ctx.deps.runtime?.shouldRelayTerminalBrowserOpens?.(),
        deferGitConfigGuardToDaemon:
          ctx.provider.supportsGitCredentialGuardHost?.(ctx.sessionId) === true
      })
      stampWslOrchestrationCompatibilityHost(
        ctx.env,
        ctx.deps.runtime?.getOrchestrationCompatibilityHostId?.(),
        ctx.codexSelectionTarget.runtime === 'wsl' ? ctx.expectedWslDistro : null
      )
      stampRuntimeSourceEnv(
        ctx.env,
        getRuntimeSourceStamp(ctx.deps.runtime, getAppEnvironment().getPath('userData'))
      )
      promoteAgentTeamsShimPath(ctx.env, ctx.requestedAgentTeamsPath)
    } catch (error) {
      // Why: host-env setup can materialize agent hooks/extensions before failing.
      if (ctx.requestedSessionId === undefined) {
        clearProviderPtyState(ctx.sessionId)
      }
      throw error
    }
  }

  return null
}

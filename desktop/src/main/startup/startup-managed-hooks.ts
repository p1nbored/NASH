import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  installManagedAgentHooks,
  resolveStartupManagedHookAction,
  shouldContinueManagedHookStartup,
  shouldInstallStartupManagedAgentHook
} from '../agent-hooks/managed-agent-hook-controls'
import { recordManagedHookInstallFailure } from '../agent-hooks/install-telemetry'
import { ensureRealHomeCodexHookState } from '../codex/codex-real-home-hook-install'

export type StartupManagedHookContext = {
  /** `shouldInstallManagedHooks(is.dev)`: false where the build must not touch user hook files. */
  readonly managedHooksAllowed: boolean
  readonly settings: () => Partial<
    Pick<GlobalSettings, 'agentCmdOverrides' | 'agentStatusHooksEnabled' | 'disabledTuiAgents'>
  >
  readonly isQuitting: () => boolean
  readonly hydrateShellPath: boolean
  readonly userDataPath: () => string
  readonly isRealCodexHomeSelected: () => boolean
}

/**
 * Startup reconciliation of the managed status hooks. In NASH both steps follow
 * `NASH_MANAGED_HOOK_AGENTS` (Claude Code only, user decision of 2026-10-06): the managed install
 * runs only Claude's installer, and the Codex real-home step is skipped. Never rejects.
 */
export async function reconcileStartupManagedHooks(
  context: StartupManagedHookContext
): Promise<void> {
  const settings = context.settings()
  // Why skip rather than remove when the off switch is set: the hook files are user-global but this
  // decision reads only THIS profile's settings, so removing here deletes the hooks every other
  // instance depends on (STA-5679). Skipping already keeps removed hooks from reappearing on launch.
  if (!context.managedHooksAllowed || resolveStartupManagedHookAction(settings) !== 'install') {
    return
  }
  // Why first: the real-home ensure's in-slot conversion must land before the managed install's
  // retired-form sweep removes the prior command; Codex's approval then runs in the background.
  // Inert while the scope excludes Codex; kept so widening the scope restores Orca's ordering.
  if (
    shouldInstallStartupManagedAgentHook(settings, 'codex') &&
    context.isRealCodexHomeSelected()
  ) {
    await ensureRealHomeCodexHookState({
      hooksEnabled: true,
      userDataPath: context.userDataPath(),
      // Why app start: the one place an older build's entry becomes the frozen command.
      writePolicy: 'convert-older-forms'
    }).catch((error: unknown) => {
      console.warn('[codex-real-home-hooks] startup ensure failed:', error)
    })
  }
  try {
    await installManagedAgentHooks(context.settings(), {
      shouldHydrateShellPath: context.hydrateShellPath,
      onInstallError: recordManagedHookInstallFailure,
      shouldContinue: (agent) =>
        shouldContinueManagedHookStartup(context.isQuitting(), context.settings(), agent)
    })
  } catch (error) {
    console.warn('[agent-hooks] failed to reconcile managed hooks on startup:', error)
  }
}

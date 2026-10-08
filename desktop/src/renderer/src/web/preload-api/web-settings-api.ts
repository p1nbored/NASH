import type { PreloadApi } from '../../../../preload/api-types'
import {
  computerAwakeSettingsForMode,
  normalizeComputerAwakeMode
} from '../../../../shared/computer-awake-mode'
import { normalizeTerminalCursorStyleDefault } from '../../../../shared/terminal-cursor-style-settings'
import {
  applyAgentPermissionMode,
  normalizeAgentPermissionMode
} from '../../../../shared/tui-agent-permissions'
import { mergeSettings } from './web-preference-normalization'
import {
  getRuntimeBackedStoredSettings,
  getStoredSettings,
  settingsForActiveVisibilityOwner,
  syncRuntimeBackedSettings,
  updateRuntimePRBotAuthorOverride,
  writeStoredSettings
} from './web-preferences-store'
import type { WebSettingsApi } from './web-preferences-store'
import {
  requireActiveEnvironmentOrNull,
  resolveEnvironment,
  webRuntimeState
} from './web-runtime-session'
import { noopUnsubscribe } from './web-storage'

export function createWebSettingsApi(): Partial<PreloadApi> {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: satisfies checks browser methods; installWebPreloadApi supplies omitted desktop methods through withFallback.
    settings: {
      get: async () => getRuntimeBackedStoredSettings(),
      // Why: localStorage-backed settings are synchronous, so the pre-hydration kill-switch read works the same as desktop.
      getSync: () => settingsForActiveVisibilityOwner(getStoredSettings()),
      set: async (updates) => {
        const sanitizedUpdates = { ...updates }
        const permissionMode = normalizeAgentPermissionMode(updates.agentPermissionMode)
        if (permissionMode) {
          const current = getStoredSettings()
          Object.assign(
            sanitizedUpdates,
            applyAgentPermissionMode({
              mode: permissionMode,
              agentDefaultArgs: updates.agentDefaultArgs ?? current.agentDefaultArgs,
              agentDefaultEnv: updates.agentDefaultEnv ?? current.agentDefaultEnv
            })
          )
        }
        const runtimeEnvironment = requireActiveEnvironmentOrNull()
        delete sanitizedUpdates.activeRuntimeEnvironmentId
        if (
          'worktreeVisibilityDefaults' in sanitizedUpdates &&
          runtimeEnvironment &&
          runtimeEnvironment.id !== webRuntimeState.worktreeVisibilityDefaultsRuntimeEnvironmentId
        ) {
          delete sanitizedUpdates.worktreeVisibilityDefaults
        }
        if ('worktreeVisibilityDefaults' in sanitizedUpdates) {
          sanitizedUpdates.worktreeVisibilityDefaults = {
            ...settingsForActiveVisibilityOwner(getStoredSettings()).worktreeVisibilityDefaults,
            ...sanitizedUpdates.worktreeVisibilityDefaults
          }
        }
        if ('computerAwakeMode' in sanitizedUpdates) {
          Object.assign(
            sanitizedUpdates,
            computerAwakeSettingsForMode(
              normalizeComputerAwakeMode(
                sanitizedUpdates.computerAwakeMode,
                sanitizedUpdates.keepComputerAwakeWhileAgentsRun
              )
            )
          )
        } else if ('keepComputerAwakeWhileAgentsRun' in sanitizedUpdates) {
          Object.assign(
            sanitizedUpdates,
            computerAwakeSettingsForMode(
              sanitizedUpdates.keepComputerAwakeWhileAgentsRun ? 'auto' : 'off'
            )
          )
        }
        if ('autoRenameBranchFromWorkDefaultedOn' in sanitizedUpdates) {
          sanitizedUpdates.autoRenameBranchFromWorkDefaultedOn = true
        }
        if ('terminalCursorStyle' in sanitizedUpdates) {
          Object.assign(
            sanitizedUpdates,
            normalizeTerminalCursorStyleDefault(
              { terminalCursorStyle: sanitizedUpdates.terminalCursorStyle },
              { preserveExplicitValue: true }
            )
          )
        }
        const localUpdates = { ...sanitizedUpdates }
        if (runtimeEnvironment) {
          delete localUpdates.worktreeVisibilityDefaults
        }
        const next = mergeSettings(getStoredSettings(), localUpdates, {
          preserveAutoRenameBranchFromWorkUpdate: 'autoRenameBranchFromWork' in sanitizedUpdates
        })
        // The host must acknowledge a permission change before the client reports it saved.
        if (!runtimeEnvironment || !permissionMode) {
          writeStoredSettings(next)
        }
        return settingsForActiveVisibilityOwner(
          await syncRuntimeBackedSettings(sanitizedUpdates, next)
        )
      },
      setActiveRuntimeEnvironmentPreference: async ({ environmentId }) => {
        const requestedEnvironmentId = environmentId?.trim() || null
        const activeRuntimeEnvironmentId = requestedEnvironmentId
          ? resolveEnvironment(requestedEnvironmentId).id
          : null
        const next = mergeSettings(getStoredSettings(), {
          activeRuntimeEnvironmentId
        })
        writeStoredSettings(next, activeRuntimeEnvironmentId)
        return next
      },
      updatePRBotAuthorOverride: (args) => updateRuntimePRBotAuthorOverride(args),
      listFonts: () => Promise.resolve([]),
      onChanged: () => noopUnsubscribe
    } satisfies Partial<WebSettingsApi> as unknown as WebSettingsApi,
    agentAwake: {
      getStatus: async () => {
        const settings = getStoredSettings()
        return {
          mode: normalizeComputerAwakeMode(
            settings.computerAwakeMode,
            settings.keepComputerAwakeWhileAgentsRun
          ),
          active: false
        }
      },
      onChanged: () => noopUnsubscribe
    }
  }
}

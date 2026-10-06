import { isAgentStatusHooksEnabledForAgent } from '../../../../shared/agent-status-hooks-setting'
import { prepareManagedWslCodexHomeBeforeShellLaunch } from '../../../codex/managed-wsl-home-shell-preflight'
import { isNashManagedHookAgent } from '../../../agent-hooks/nash-managed-hook-scope'
import { defineMethod } from '../core'
import { PrepareCodexForWslPaneParams } from '../../../../shared/rpc-contract/agent-hooks-params'

export const AGENT_HOOK_METHODS = [
  defineMethod({
    name: 'agentHooks.prepareCodexForWslPane',
    params: PrepareCodexForWslPaneParams,
    handler: async (params, { runtime, clientKind }) => {
      if (clientKind !== undefined) {
        throw new Error('Codex hook preparation is only available to the local Orca CLI.')
      }
      return await prepareManagedWslCodexHomeBeforeShellLaunch({
        env: {
          CODEX_HOME: params.codexHome,
          ORCA_CODEX_HOME: params.orcaCodexHome,
          WSL_DISTRO_NAME: params.wslDistro
        },
        // Why scoped: NASH installs no Codex hooks (Claude-only decision of 2026-10-06).
        hooksEnabled:
          isNashManagedHookAgent('codex') &&
          isAgentStatusHooksEnabledForAgent(runtime.getClientSettings(), 'codex')
      })
    }
  })
]

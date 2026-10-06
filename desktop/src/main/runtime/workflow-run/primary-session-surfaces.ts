import { toAgentLaunchPreferences } from '../../../shared/agent-launch-preferences'
import type { TerminalSpawnDispatch } from '../../agent-launch/agent-launch-not-started'
import type { AgentLaunchSurfaceFactory } from '../../agent-launch/agent-launch-surface-factories'
import type { PrimaryTerminalPort } from './primary-session-ports'

/** The telemetry label of a run's primary launch; read as attribution only, never as behaviour. */
export const PRIMARY_SESSION_LAUNCH_SOURCE = 'workbench'

/**
 * The surfaces `executeAgentLaunch` builds a primary session with: a terminal only. The tab opens in
 * the background with `surfaceOwner: false` and no focus, activate or presentation, so a launch never
 * steals focus. A structured session is refused with an error that is not a definitive refusal, so
 * the executor cannot downgrade around it and nothing is created.
 */
export function createPrimarySessionSurfaces(
  terminal: Pick<PrimaryTerminalPort, 'createTerminal'>,
  spawn: TerminalSpawnDispatch
): AgentLaunchSurfaceFactory {
  return {
    createStructuredSession: async () => {
      throw new Error('autopilot_launch_structured_refused')
    },
    createTerminalAgent: async ({
      worktreeId,
      agent,
      startupPrompt,
      agentArgs,
      cwd,
      launchSource,
      options
    }) => {
      const launchPreferences = toAgentLaunchPreferences(options)
      const created = await terminal
        .createTerminal(`id:${worktreeId}`, {
          startupAgent: agent,
          ...(startupPrompt ? { startupPrompt } : {}),
          ...(agentArgs !== undefined ? { agentArgs } : {}),
          ...(cwd ? { cwd } : {}),
          ...(launchPreferences ? { launchPreferences } : {}),
          launchSource: launchSource ?? PRIMARY_SESSION_LAUNCH_SOURCE,
          surfaceOwner: false,
          onPtySpawnDispatched: spawn.onPtySpawnDispatched
        })
        .catch(spawn.rethrow)
      return {
        handle: created.handle,
        ...(created.paneKey ? { paneKey: created.paneKey } : {}),
        ...(created.warning ? { warning: created.warning } : {})
      }
    }
  }
}

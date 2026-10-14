import { resolveAgentStartupPlanInputs } from '../../../shared/agent-startup-plan-inputs'
import { toAgentLaunchPreferences } from '../../../shared/agent-launch-preferences'
import { resolveStartupShell } from '../../../shared/tui-agent-startup'
import { catalogRoutingEfforts } from '../../../shared/routing-table/routing-model-options'
import { supportsTaskReadOnly } from '../../../shared/task-agent-launch-permissions'
import type {
  PrimarySessionLaunchSpec,
  PrimarySessionPreflightInput,
  StartupPlanBuilder
} from './primary-session-preflight'
import { resolvePrimaryPermissionMode } from './primary-session-permission'
import {
  parsePrimaryModelChoice,
  primarySessionOk,
  primarySessionRefused,
  type PrimarySessionResult
} from './primary-session-types'

/** Uses the same native model adapter and permission arguments as a routed worker. */
export function runNativePrimaryPreflight(
  input: PrimarySessionPreflightInput,
  buildPlan: StartupPlanBuilder
): PrimarySessionResult<PrimarySessionLaunchSpec> {
  if (input.access === 'read_only' && !supportsTaskReadOnly(input.agent, input.platform)) {
    return primarySessionRefused(
      'autopilot_session_posture_invalid',
      `NASH cannot enforce read-only access for ${input.agent} on this host. Choose a supported CLI or request workspace-write access.`
    )
  }
  if (input.settings.agentCmdOverrides?.[input.agent]) {
    return primarySessionRefused(
      'autopilot_session_command_override',
      'The primary launch command is overridden in Settings; remove the override to start a run.'
    )
  }
  const mode = resolvePrimaryPermissionMode(input.access)
  const choice = parsePrimaryModelChoice(input.agent, input.model, input.effort)
  if (!mode.ok) {
    return mode
  }
  if (!choice.ok) {
    return choice
  }
  const explicitNone =
    input.agent === 'codex' || catalogRoutingEfforts(input.agent, input.model).includes('none')
  const sessionOptions = {
    model: choice.value.model,
    ...(choice.value.effort === 'none' && !explicitNone ? {} : { effort: choice.value.effort }),
    taskAccess: input.access,
    routeValidated: 'true' as const
  }
  const base = resolveAgentStartupPlanInputs({
    agent: input.agent,
    settings: input.settings,
    platform: input.platform,
    isRemote: false,
    shell: undefined,
    sessionOptions
  })
  const shell = resolveStartupShell(input.platform, base.shell)
  const plan = buildPlan({ ...base, prompt: 'Preflight probe.' })
  if (
    !plan ||
    plan.sessionOptions?.model !== input.model ||
    (sessionOptions.effort !== undefined && plan.sessionOptions?.effort !== sessionOptions.effort)
  ) {
    return primarySessionRefused(
      'autopilot_session_startup_plan_mismatch',
      'The native startup plan did not preserve the selected model, effort and task permissions.'
    )
  }
  return primarySessionOk({
    agentArgs: base.agentArgs ?? '',
    permissionMode: mode.value,
    sessionOptions,
    launchPreferences: toAgentLaunchPreferences(sessionOptions),
    shell,
    probeCommand: plan.launchCommand
  })
}

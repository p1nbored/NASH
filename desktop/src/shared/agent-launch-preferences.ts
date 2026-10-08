import type { AgentLaunchPreferences } from './agent-session-host-authority'

/** Session options as the model, effort and mode a launch starts with; one converter for every lane,
 *  so a structured create and a terminal launch read the same picks the same way. */
export function toAgentLaunchPreferences(
  sessionOptions: Readonly<Record<string, unknown>> | null | undefined
): AgentLaunchPreferences | undefined {
  if (!sessionOptions) {
    return undefined
  }
  const readString = (key: keyof AgentLaunchPreferences): string | undefined => {
    const value = sessionOptions[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  const model = readString('model')
  const effort = readString('effort')
  const mode = readString('mode')
  const taskAccess = sessionOptions.taskAccess
  const routeValidated =
    sessionOptions.routeValidated === true || sessionOptions.routeValidated === 'true'
  const preferences: AgentLaunchPreferences = {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(mode ? { mode } : {}),
    ...(taskAccess === 'read_only' || taskAccess === 'workspace_write' ? { taskAccess } : {}),
    ...(routeValidated ? { routeValidated: true } : {})
  }
  return Object.keys(preferences).length > 0 ? preferences : undefined
}

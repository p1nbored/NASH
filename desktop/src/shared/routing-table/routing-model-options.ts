import { getAgentSessionOptionLaunchCatalog } from '../agent-session-option-launch'
import type { RoutingAgent } from './routing-cli-registry'

/** The same launchable effort choices for the picker, route check and primary startup. */
export function catalogRoutingEfforts(agent: RoutingAgent, modelId: string): string[] {
  const catalog = getAgentSessionOptionLaunchCatalog(agent)!
  const model = catalog.models.find(
    (entry) =>
      entry.id === modelId || (agent === 'claude' && modelId.startsWith(`claude-${entry.id}-`))
  )
  const effort = (model?.options ?? catalog.unknownModelOptions ?? []).find(
    (option) => option.id === 'effort' && option.category === 'thought_level'
  )
  return effort?.kind.type === 'select' &&
    (effort.apply.launchArgs || effort.apply.composedIntoModel)
    ? effort.kind.choices.map((choice) => choice.value)
    : []
}

import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import type { RoutingModel } from '../../../../shared/workbench-routing-table-view'
import {
  CONCRETE_REASONING_LEVELS,
  type ConcreteReasoningLevel,
  type ExecutionTarget,
  type ValidationReviewerTarget
} from '../../../../shared/routing-table/routing-table-taxonomy'

export type RoutingCli = 'claude' | 'codex' | 'antigravity'

export function routingCli(target: ExecutionTarget | ValidationReviewerTarget): RoutingCli {
  return target === 'codex_cli' ? 'codex' : target === 'agy_cli' ? 'antigravity' : 'claude'
}

export function routingEffortOptions(
  agent: RoutingCli,
  model: string,
  models?: readonly RoutingModel[] | null
): ConcreteReasoningLevel[] {
  const listed = models?.find((entry) => entry.id === model)
  if (listed) {
    return CONCRETE_REASONING_LEVELS.filter((level) => listed.efforts.includes(level))
  }
  const catalog = getAgentSessionOptionCatalog(agent)
  const id = model.trim()
  const entry = catalog?.models.find(
    (candidate) =>
      candidate.id === id || (agent === 'claude' && id.startsWith(`claude-${candidate.id}-`))
  )
  const options = entry?.options ?? catalog?.unknownModelOptions ?? []
  const effort = options.find((option) => option.category === 'thought_level')
  if (effort?.kind.type !== 'select') {
    return []
  }
  const choices = effort.kind.choices
  return CONCRETE_REASONING_LEVELS.filter((level) =>
    choices.some((choice) => choice.value === level)
  )
}

/** Keep a supported selection when the CLI or model changes; otherwise choose its usual depth. */
export function routingEffortFor(
  agent: RoutingCli,
  model: string,
  current: ConcreteReasoningLevel | 'inherit',
  models?: readonly RoutingModel[] | null
): ConcreteReasoningLevel {
  const levels = routingEffortOptions(agent, model, models)
  if (current !== 'inherit' && levels.includes(current)) {
    return current
  }
  return levels.includes('high') ? 'high' : (levels[0] ?? 'none')
}

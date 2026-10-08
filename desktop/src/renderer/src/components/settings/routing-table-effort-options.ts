import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
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

export function routingEffortOptions(agent: RoutingCli, model: string): ConcreteReasoningLevel[] {
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
  current: ConcreteReasoningLevel | 'inherit'
): ConcreteReasoningLevel {
  const levels = routingEffortOptions(agent, model)
  if (current !== 'inherit' && levels.includes(current)) {
    return current
  }
  return levels.includes('high') ? 'high' : (levels[0] ?? 'none')
}

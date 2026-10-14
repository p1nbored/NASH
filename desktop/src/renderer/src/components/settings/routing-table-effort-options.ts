import { catalogRoutingEfforts } from '../../../../shared/routing-table/routing-model-options'
import {
  routingAgentForTarget,
  type RoutingAgent
} from '../../../../shared/routing-table/routing-cli-registry'
import type { RoutingModel } from '../../../../shared/workbench-routing-table-view'
import {
  CONCRETE_REASONING_LEVELS,
  type ConcreteReasoningLevel,
  type ExecutionTarget,
  type ValidationReviewerTarget
} from '../../../../shared/routing-table/routing-table-taxonomy'

export type RoutingCli = RoutingAgent

export function routingCli(target: ExecutionTarget | ValidationReviewerTarget): RoutingCli {
  return routingAgentForTarget(target)
}

const MODEL_EFFORT_SUFFIX = /-(none|minimal|low|medium|high|xhigh|max|ultra)$/

/** Antigravity's discovered IDs encode effort; only listed sibling IDs may replace one. */
export function routingModelForEffort(
  agent: RoutingCli,
  model: string,
  effort: ConcreteReasoningLevel | 'inherit',
  models?: readonly RoutingModel[] | null
): string {
  if (agent !== 'antigravity' || !MODEL_EFFORT_SUFFIX.test(model)) {
    return model
  }
  const next = model.replace(MODEL_EFFORT_SUFFIX, `-${effort}`)
  return models?.some((entry) => entry.id === next) ? next : model
}

export function routingEffortOptions(
  agent: RoutingCli,
  model: string,
  models?: readonly RoutingModel[] | null
): ConcreteReasoningLevel[] {
  const listed = models?.find((entry) => entry.id === model)
  if (agent === 'antigravity' && listed && MODEL_EFFORT_SUFFIX.test(model)) {
    const family = model.replace(MODEL_EFFORT_SUFFIX, '')
    return CONCRETE_REASONING_LEVELS.filter((level) =>
      models?.some((entry) => entry.id === `${family}-${level}` && entry.efforts.includes(level))
    )
  }
  if (listed) {
    return CONCRETE_REASONING_LEVELS.filter((level) => listed.efforts.includes(level))
  }
  const choices = catalogRoutingEfforts(agent, model.trim())
  return CONCRETE_REASONING_LEVELS.filter((level) => choices.includes(level))
}

/** Keep a supported selection when the CLI or model changes; otherwise choose its usual depth. */
export function routingEffortFor(
  agent: RoutingCli,
  model: string,
  current: ConcreteReasoningLevel | 'inherit',
  models?: readonly RoutingModel[] | null
): ConcreteReasoningLevel {
  const levels = routingEffortOptions(agent, model, models)
  if (agent === 'antigravity') {
    const encoded = MODEL_EFFORT_SUFFIX.exec(model)?.[1]
    const supported = levels.find((level) => level === encoded)
    if (supported) {
      return supported
    }
  }
  if (current !== 'inherit' && levels.includes(current)) {
    return current
  }
  return levels.includes('high') ? 'high' : (levels[0] ?? 'none')
}

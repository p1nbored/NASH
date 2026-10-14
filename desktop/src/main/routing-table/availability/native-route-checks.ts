import { catalogRoutingEfforts } from '../../../shared/routing-table/routing-model-options'
import type { RoutingAgent } from '../../../shared/routing-table/routing-cli-registry'
import { authCheckOf, limitsForProvider, quotaCheckOf } from './route-auth-quota-checks'
import type { RouteSubject } from './route-availability-types'
import type { RouteCheckResult, RouteObservations } from './route-check-observations'
import { cliCheckOf } from './route-cli-detection-check'
import { reasoningCheckOf, type EffortMapping } from './route-effort-mapping'
import { checkModel } from './route-model-check'

export function checkNativeRoute(
  agent: Exclude<RoutingAgent, 'claude' | 'codex' | 'antigravity'>,
  subject: RouteSubject,
  observations: RouteObservations
): RouteCheckResult {
  const model = checkModel(subject.model, observations.listing, { matchResolvedModel: false })
  let mapping: EffortMapping | null = null
  if (model.rows !== null) {
    const efforts = catalogRoutingEfforts(agent, subject.model)
    const omit = efforts.length === 0 && subject.reasoningLevel === 'none'
    const supported = efforts.includes(subject.reasoningLevel)
    mapping =
      supported || omit || subject.requirement === 'if_supported'
        ? {
            status: 'resolved',
            effort: supported ? subject.reasoningLevel : null,
            delivery: supported ? 'native_session_option' : 'omitted',
            resolution: supported || omit ? 'applied' : 'omitted_unsupported'
          }
        : { status: 'unsupported' }
  }
  const limits = limitsForProvider(observations.rateLimits, agent)
  return {
    checks: [
      cliCheckOf(observations.detection, agent),
      model.outcome,
      ...(mapping ? [reasoningCheckOf(mapping)] : []),
      limits
        ? authCheckOf(limits, observations.nowMs)
        : {
            check: 'auth',
            result: 'pass',
            evidence: { observed: false, metered: false, basis: 'native_cli_at_launch' }
          },
      limits
        ? quotaCheckOf(agent, observations.rateLimits, observations.nowMs)
        : { check: 'quota', result: 'pass', evidence: { observed: false, metered: false } }
    ],
    mapping
  }
}

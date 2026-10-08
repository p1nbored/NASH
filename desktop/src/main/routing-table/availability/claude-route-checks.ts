import { commonListedEfforts } from './listed-model-match'
import type { LiveRunPrimary, RouteSubject } from './route-availability-types'
import type { RouteCheckResult, RouteObservations } from './route-check-observations'
import { cliCheckOf } from './route-cli-detection-check'
import { claudeDeliveryFor, mapClaudeEffort, reasoningCheckOf } from './route-effort-mapping'
import { checkModel } from './route-model-check'
import { authQuotaChecksOf } from './route-auth-quota-checks'

/** The live-primary evidence, when this route is in-session and the caller gave usable ids. */
function inheritedLoginFor(
  subject: RouteSubject,
  observations: RouteObservations
): LiveRunPrimary | null {
  const live = observations.liveRunPrimary
  const usable = live !== null && live.runId.trim() !== '' && live.ownerId.trim() !== ''
  return usable &&
    live.agent === 'claude' &&
    (subject.target === 'claude_subagent' || subject.target === 'claude_workflow') &&
    subject.primaryAgent === 'claude'
    ? live
    : null
}

/**
 * Claude routes: the primary session, a subagent, a workflow and the headless reviewer all run the
 * installed `claude`, so one account listing, one login and one quota pool decide them.
 * The listing is matched on the listed value or the full id it resolves to.
 */
export function checkClaudeRoute(
  subject: RouteSubject,
  observations: RouteObservations
): RouteCheckResult {
  const model = checkModel(subject.model, observations.listing, { matchResolvedModel: true })
  const mapping =
    model.rows === null
      ? null
      : mapClaudeEffort({
          level: subject.reasoningLevel,
          requirement: subject.requirement,
          delivery:
            subject.target === 'claude_subagent' && subject.primaryAgent === 'codex'
              ? 'claude_effort_flag'
              : claudeDeliveryFor(subject.target, subject.inheritsCoordinator),
          listedEfforts: commonListedEfforts(model.rows, observations.listing)
        })
  return {
    checks: [
      cliCheckOf(observations.detection, 'claude'),
      model.outcome,
      ...(mapping === null ? [] : [reasoningCheckOf(mapping)]),
      ...authQuotaChecksOf('claude', observations, inheritedLoginFor(subject, observations))
    ],
    mapping
  }
}

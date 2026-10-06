import type { ClassificationResult } from '../../../shared/clef/clef-classification-contract'
import { INHERIT } from '../../../shared/routing-table/routing-table-taxonomy'
import type { ConfiguredRoute, ResolvedRoute } from '../../routing-table/route-resolver'
import { JsonObjectSchema, type JsonObject } from '../orchestration/db/autopilot-json-column'
import { TASK_ROUTE_POLICY_LEVELS } from '../orchestration/db/autopilot-task-schema-definition'
import type { TaskClassificationRecord } from '../orchestration/db/task-classification-store'
import type { TaskRouteInput } from '../orchestration/db/task-route-store'
import type { ClassificationRouteOutcome, ClassificationRun } from './classification-ports'

type PolicyLevel = (typeof TASK_ROUTE_POLICY_LEVELS)[number]

function policyLevelOf(level: string): PolicyLevel | null {
  return TASK_ROUTE_POLICY_LEVELS.find((known) => known === level) ?? null
}

/** An inheriting row names no model of its own; one that inherits only the model records the concrete one. */
function modelColumnOf(configured: ConfiguredRoute, subjectModel: string): string | null {
  if (configured.model !== INHERIT) {
    return configured.model
  }
  return configured.reasoningLevel === INHERIT ? null : subjectModel
}

/** The resolved route as it was given: the table row, and the availability verdict with its reasons. */
function routeInputOf(
  classificationId: string,
  route: ResolvedRoute,
  timestamp: string
): TaskRouteInput {
  const { configured, availability } = route
  return {
    classificationId,
    routingTableVersion: route.table.version,
    routingTableSha256: route.table.sha256,
    target: route.target,
    model: modelColumnOf(configured, availability.subject.model),
    policyLevel: policyLevelOf(configured.reasoningLevel),
    cliSetting: availability.cli === null ? null : { ...availability.cli },
    status: availability.status,
    reasons: [...availability.reasons],
    availability: jsonObjectOf({
      subject: availability.subject,
      status: availability.status,
      reasons: availability.reasons,
      cli: availability.cli,
      snapshot: availability.snapshot
    }),
    timestamp
  }
}

/** A JSON round trip drops absent optional fields, which a JSON column cannot hold. */
function jsonObjectOf(value: object): JsonObject {
  const plain: unknown = JSON.parse(JSON.stringify(value))
  return JsonObjectSchema.parse(plain)
}

/**
 * The route of a classified TaskSpec. Kept by the primary: no lookup, a `not_delegated` row naming the
 * run's launch table. Delegated: one lookup in the active table; an unavailable route is recorded with
 * its reasons, and a refused lookup records nothing. No other model, target or level is ever tried.
 */
export async function routeClassification(
  run: ClassificationRun,
  classification: TaskClassificationRecord,
  result: ClassificationResult
): Promise<ClassificationRouteOutcome> {
  const { deps, subject } = run
  const timestamp = (): string => new Date(deps.clock.now()).toISOString()
  if (!result.needsDelegation) {
    const route = deps.routes.record({
      classificationId: classification.classificationId,
      routingTableVersion: subject.runTable.version,
      routingTableSha256: subject.runTable.sha256,
      target: null,
      model: null,
      policyLevel: null,
      cliSetting: null,
      status: 'not_delegated',
      reasons: [],
      availability: null,
      timestamp: timestamp()
    })
    return { kind: 'recorded', route }
  }
  const resolution = await deps.routing.resolveRoute({
    taskType: result.taskType,
    workspace: { workspaceId: subject.workspaceId },
    liveRunPrimary: subject.liveRunPrimary,
    signal: run.signal
  })
  if (!resolution.ok) {
    return { kind: 'refused', reason: resolution.reason }
  }
  const input = routeInputOf(classification.classificationId, resolution.route, timestamp())
  return { kind: 'recorded', route: deps.routes.record(input) }
}

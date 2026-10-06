import { z } from 'zod'
import {
  RouteBlockerDetailSchema,
  type RouteBlockerDetail
} from '../../../shared/clef/clef-route-contract'
import { DOT_INGRESS_PRINCIPAL_ID } from '../../../shared/dot-ingress/dot-ingress-limits'
import type { DotRunView } from '../../../shared/dot-ingress/dot-ingress-request'
import type { DotRequestRecord } from '../orchestration/db/dot-ingress-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { WORKBENCH_STORED_STATUSES } from '../orchestration/db/workbench-request-schema-definition'
import type { WorkflowRunStatus } from '../orchestration/db/workflow-run-transition'
import { findDotRequestRun, hasAppTable } from './dot-ingress-run-link'

// U32: dot sees one coarse run state and, for a blocked launch, one coarse blocker. No task, model,
// effort, route, terminal or progress detail is ever part of it.

type DotRunBlocker = NonNullable<DotRunView['blocker']>
type WorkbenchStoredStatus = (typeof WORKBENCH_STORED_STATUSES)[number]

const NOT_STARTED: DotRunView = { state: 'not_started', blocker: null }
const UNVERIFIABLE: DotRunView = { state: 'unverifiable', blocker: null }

const RUN_STATE = {
  launching: 'launching',
  active: 'active',
  completing: 'completing',
  completed: 'completed',
  failed: 'failed',
  canceled: 'canceled',
  unverifiable: 'unverifiable'
} as const satisfies Record<WorkflowRunStatus, DotRunView['state']>

/** Without a run record, the request's own stored status is the evidence. */
const UNLAUNCHED_STATE = {
  RECEIVED: NOT_STARTED,
  LAUNCHING: { state: 'launching', blocker: null },
  // Why: the door records a launch only with its run, so a missing run is not proof of anything.
  LAUNCHED: UNVERIFIABLE,
  LAUNCH_BLOCKED: { state: 'blocked', blocker: 'other' },
  CANCELED: { state: 'canceled', blocker: null }
} as const satisfies Record<WorkbenchStoredStatus, DotRunView>

const LAUNCH_FAILURES: ReadonlySet<RouteBlockerDetail> = new Set([
  'launch_refused',
  'launch_unverifiable'
])

const WorkbenchLaunchRowSchema = z.object({
  status: z.enum(WORKBENCH_STORED_STATUSES),
  blocker_detail: z.string().nullable()
})

function blockerOf(detail: string | null): DotRunBlocker {
  const parsed = RouteBlockerDetailSchema.safeParse(detail)
  if (!parsed.success) {
    return 'other'
  }
  if (parsed.data === 'coordinator_route_unavailable') {
    return 'coordinator_route_unavailable'
  }
  return LAUNCH_FAILURES.has(parsed.data) ? 'launch_failed' : 'other'
}

/** Read-only and scoped to the dot principal; a missing table or row is no launch evidence. */
function readLaunchRow(db: OrchestrationDb, requestId: string) {
  if (!hasAppTable(db, 'workbench_requests')) {
    return null
  }
  const row = db.db
    .prepare(
      'SELECT status, blocker_detail FROM workbench_requests WHERE request_id = ? AND principal_id = ?'
    )
    .get(requestId, DOT_INGRESS_PRINCIPAL_ID)
  const parsed = WorkbenchLaunchRowSchema.safeParse(row)
  return parsed.success ? parsed.data : null
}

/** The coarse run view of a dot request; null for a canceled or failed request, which shows none. */
export function projectDotRun(db: OrchestrationDb, record: DotRequestRecord): DotRunView | null {
  if (record.state === 'received') {
    return NOT_STARTED
  }
  if (record.state !== 'submitted' || record.workbenchRequestId === null) {
    return null
  }
  const launch = readLaunchRow(db, record.workbenchRequestId)
  if (!launch) {
    return UNVERIFIABLE
  }
  if (launch.status === 'LAUNCH_BLOCKED') {
    return { state: 'blocked', blocker: blockerOf(launch.blocker_detail) }
  }
  const run = findDotRequestRun(db, record)
  return run ? { state: RUN_STATE[run.status], blocker: null } : UNLAUNCHED_STATE[launch.status]
}

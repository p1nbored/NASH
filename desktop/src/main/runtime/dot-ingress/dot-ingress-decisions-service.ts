import { WORKFLOW_RUN_STATUSES } from '../orchestration/db/autopilot-run-schema-definition'
import { getDotIngressStore } from '../orchestration/db/dot-ingress-store'
import {
  getPermissionDecisionStore,
  type PermissionDecisionRecord
} from '../orchestration/db/permission-decision-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { WORKFLOW_RUN_TERMINAL_STATUSES } from '../orchestration/db/workflow-run-transition'
import { DOT_ALLOW_REFUSED_CODE } from '../permission-relay/permission-dot-allow'
import { PERMISSION_RELAY_ERROR_CODES } from '../permission-relay/permission-relay-caller'
import type { DotDecisionRelay, DotIngressServiceDeps } from './dot-ingress-ports'
import { dotRefusal, orchestrationCodeOf, requireDotInterfaceOn } from './dot-ingress-refusals'
import { findDotRequestOfRun, findDotRequestRun, hasAppTable } from './dot-ingress-run-link'

// D-017: dot sees and answers only the prompts of runs a dot request started, through the relay's
// first-answer-wins path. A prompt with no answer keeps waiting in the app for the user.

export type DotDecisionEntry = { record: PermissionDecisionRecord; dotRequestId: string }
export type DotDecisionAnswer = DotDecisionEntry & {
  outcome: 'decided' | 'already_decided' | 'closed'
}

const TERMINAL: ReadonlySet<string> = new Set(WORKFLOW_RUN_TERMINAL_STATUSES)
const OPEN_RUN_STATUSES = WORKFLOW_RUN_STATUSES.filter((status) => !TERMINAL.has(status))
const OPEN_RUN_SCAN_LIMIT = 100

// Relay refusals as dot codes; a read-only run keeps an allow for the desktop until a sandbox exists (RG7).
const REFUSALS_BY_RELAY_CODE: ReadonlyMap<string, () => Error> = new Map([
  [PERMISSION_RELAY_ERROR_CODES.desktopOnly, () => dotRefusal('dot_decision_desktop_only')],
  [DOT_ALLOW_REFUSED_CODE, () => dotRefusal('dot_decision_deny_only', { reason: 'run_read_only' })],
  [PERMISSION_RELAY_ERROR_CODES.notFound, () => dotRefusal('dot_decision_not_found')]
])

function relayOrNull(deps: DotIngressServiceDeps): DotDecisionRelay | null {
  try {
    return deps.relay()
  } catch (error) {
    if (orchestrationCodeOf(error) === PERMISSION_RELAY_ERROR_CODES.unavailable) {
      return null
    }
    throw error
  }
}

type DotRun = { runId: string; dotRequestId: string }

function openDotRuns(db: OrchestrationDb): DotRun[] {
  if (!hasAppTable(db, 'workflow_runs')) {
    return []
  }
  return getWorkflowRunStore(db)
    .listByStatus(OPEN_RUN_STATUSES, OPEN_RUN_SCAN_LIMIT)
    .flatMap((run) => {
      const dot = findDotRequestOfRun(db, run.runId)
      return dot ? [{ runId: run.runId, dotRequestId: dot.dotRequestId }] : []
    })
}

function runsOfRequest(db: OrchestrationDb, dotRequestId: string): DotRun[] {
  const run = findDotRequestRun(db, getDotIngressStore(db).get(dotRequestId))
  return run ? [{ runId: run.runId, dotRequestId }] : []
}

/** Pending prompts dot may see, oldest first; none while no relay runs, since none could be answered. */
export function listDotDecisions(
  deps: DotIngressServiceDeps,
  input: { dotRequestId?: string; limit: number }
): DotDecisionEntry[] {
  requireDotInterfaceOn(deps.db)
  const runs =
    input.dotRequestId === undefined
      ? openDotRuns(deps.db)
      : runsOfRequest(deps.db, input.dotRequestId)
  const relay = relayOrNull(deps)
  if (!relay) {
    return []
  }
  return runs
    .flatMap(({ runId, dotRequestId }) =>
      relay
        .listForDot(runId, { statuses: ['pending'], limit: input.limit })
        .map((record) => ({ record, dotRequestId }))
    )
    .sort((left, right) => left.record.createdAt.localeCompare(right.record.createdAt))
    .slice(0, input.limit)
}

/** Answers one prompt after proving its run came from a dot request; a prompt of any other run is not found. */
export function answerDotDecision(
  deps: DotIngressServiceDeps,
  input: { decisionId: string; decision: 'allow' | 'deny' }
): DotDecisionAnswer {
  requireDotInterfaceOn(deps.db)
  const existing = hasAppTable(deps.db, 'permission_decisions')
    ? getPermissionDecisionStore(deps.db).get(input.decisionId)
    : null
  const dot = existing ? findDotRequestOfRun(deps.db, existing.runId) : null
  if (!existing || !dot) {
    throw dotRefusal('dot_decision_not_found')
  }
  const relay = relayOrNull(deps)
  if (!relay) {
    throw dotRefusal('dot_decision_desktop_only', { reason: 'relay_unavailable' })
  }
  let answered: ReturnType<DotDecisionRelay['answerFromDot']>
  try {
    answered = relay.answerFromDot(input)
  } catch (error) {
    const refusal = REFUSALS_BY_RELAY_CODE.get(orchestrationCodeOf(error) ?? '')
    throw refusal ? refusal() : error
  }
  if (answered.outcome === 'not_found') {
    throw dotRefusal('dot_decision_not_found')
  }
  return { outcome: answered.outcome, record: answered.record, dotRequestId: dot.dotRequestId }
}

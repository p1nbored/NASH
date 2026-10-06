import type { RoutingTable } from '../../../shared/routing-table/routing-table-schema'
import {
  RoutingTableAvailabilityViewSchema,
  type RouteAvailabilityView,
  type RouteUnavailableReason,
  type RoutingTableAvailabilityView
} from '../../../shared/workbench-route-availability-view'
import { AGENT_MODEL_CATALOG_FRESH_MS } from '../../native-chat/agent-model-catalog/agent-model-catalog-store'
import type {
  CheckOutcome,
  RouteAvailabilityResult,
  UnavailableReason
} from '../../routing-table/availability/route-availability-types'
import type { RouteResolver, TableAvailability } from '../../routing-table/route-resolver'

/** What the Settings screen reads from B2's resolver: a table-wide evaluation. */
export type RoutingTableAvailabilitySource = Pick<RouteResolver, 'evaluateTable'>

/** A detection, model listing or user check older than this no longer counts: the route reads "not checked". */
export const ROUTE_READING_FRESH_MS = AGENT_MODEL_CATALOG_FRESH_MS

const NOT_CHECKED: RouteAvailabilityView = {
  status: 'unverified',
  reasons: ['not_checked'],
  awaitingUserConfirmation: false
}

// Why per source: a user check reads every CLI, so its model-list failures are real attempts, not gaps.
const lastUserCheckAtMs = new WeakMap<RoutingTableAvailabilitySource, number>()

// Why a typed identity: a reason the checks add without a shared code fails to compile here.
function unavailableReason(reason: UnavailableReason): RouteUnavailableReason {
  return reason
}

/** A stand-in latch for a damaged latch file is not a sign-in or quota failure, so it is named apart. */
function failReason(check: CheckOutcome): RouteUnavailableReason | null {
  if (check.result !== 'fail') {
    return null
  }
  return check.check === 'latch' && check.evidence?.source === 'availability_file_damaged'
    ? 'availability_record_damaged'
    : unavailableReason(check.reason)
}

function unavailableView(
  checks: readonly CheckOutcome[],
  awaitingUserConfirmation: boolean
): RouteAvailabilityView | null {
  const [first, ...rest] = [...new Set(checks.flatMap((check) => failReason(check) ?? []))]
  return first === undefined
    ? null
    : { status: 'unavailable', reasons: [first, ...rest], awaitingUserConfirmation }
}

function awaitsConfirmation(result: RouteAvailabilityResult): boolean {
  return result.snapshot.checks.some((check) => check.evidence?.awaitingUserConfirmation === true)
}

/** The verdict as the checks gave it, reasons as codes only. */
export function checkedRouteView(result: RouteAvailabilityResult): RouteAvailabilityView {
  const awaitingUserConfirmation = awaitsConfirmation(result)
  switch (result.status) {
    case 'available':
      return { status: 'available', reasons: [], awaitingUserConfirmation }
    case 'unavailable':
      return (
        unavailableView(result.snapshot.checks, awaitingUserConfirmation) ?? {
          status: 'unavailable',
          reasons: result.reasons.map(unavailableReason),
          awaitingUserConfirmation
        }
      )
    case 'unverified':
      return { status: 'unverified', reasons: [...result.reasons], awaitingUserConfirmation }
  }
}

function isFresh(observedAtMs: number | null | undefined, nowMs: number): boolean {
  if (observedAtMs === null || observedAtMs === undefined) {
    return false
  }
  const age = nowMs - observedAtMs
  return age >= 0 && age <= ROUTE_READING_FRESH_MS
}

/** Read recently: its own CLI's model list, a detection that found its CLI unusable, or a user check. */
function wasRead(result: RouteAvailabilityResult, userCheckAtMs: number | undefined): boolean {
  const { checkedAtMs, observedAtMs, checks } = result.snapshot
  if (isFresh(observedAtMs.models, checkedAtMs)) {
    return true
  }
  if (!isFresh(observedAtMs.detection, checkedAtMs)) {
    return false
  }
  const cliFailed = checks.some((check) => check.check === 'cli' && check.result === 'fail')
  return cliFailed || isFresh(userCheckAtMs, checkedAtMs)
}

/** A cached result: as is when the route was read recently, else "not checked"; a latch shows either way. */
export function listedRouteView(
  result: RouteAvailabilityResult,
  userCheckAtMs?: number
): RouteAvailabilityView {
  if (wasRead(result, userCheckAtMs)) {
    return checkedRouteView(result)
  }
  const latches = result.snapshot.checks.filter((check) => check.check === 'latch')
  return unavailableView(latches, false) ?? NOT_CHECKED
}

function tableView(
  evaluated: TableAvailability,
  view: (result: RouteAvailabilityResult) => RouteAvailabilityView
): RoutingTableAvailabilityView {
  return RoutingTableAvailabilityViewSchema.parse({
    coordinator: view(evaluated.coordinator),
    routes: evaluated.routes.map((row) => ({
      taskType: row.taskType,
      availability: view(row.availability)
    })),
    reviewers: evaluated.reviewers.map((row) => view(row.availability))
  })
}

/** For the list: held readings plus Codex's PATH lookup; never a CLI process, network call or login read. */
export async function listedTableAvailability(
  source: RoutingTableAvailabilitySource,
  table: RoutingTable
): Promise<RoutingTableAvailabilityView> {
  const evaluated = await source.evaluateTable(table, { freshness: 'cached', workspace: null })
  const userCheckAtMs = lastUserCheckAtMs.get(source)
  return tableView(evaluated, (result) => listedRouteView(result, userCheckAtMs))
}

/** "Check now", the user's explicit action: reads detection, every CLI's model list and the limits. */
export async function checkedTableAvailability(
  source: RoutingTableAvailabilitySource,
  table: RoutingTable
): Promise<RoutingTableAvailabilityView> {
  const evaluated = await source.evaluateTable(table, { freshness: 'recheck', workspace: null })
  lastUserCheckAtMs.set(source, evaluated.coordinator.snapshot.checkedAtMs)
  return tableView(evaluated, checkedRouteView)
}

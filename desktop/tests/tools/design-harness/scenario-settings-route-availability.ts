import type {
  RouteAvailabilityView,
  RoutingTableAvailabilityView
} from '../../../src/shared/workbench-route-availability-view'
import type { WorkbenchRoutingTableListResult } from '../../../src/shared/workbench-routing-table-view'
import { fixtureAvailability } from '../../../src/renderer/src/components/settings/routing-table-view.test-fixture'

// FIXTURE_ONLY route availability for Settings captures: what main lists from cached readings, and
// what "Check routes" answers. No CLI, login or network is touched; the readings live in the page.

const AVAILABLE: RouteAvailabilityView = {
  status: 'available',
  reasons: [],
  awaitingUserConfirmation: false
}

/** Before any check, main lists every route as not checked. */
export function harnessListedAvailability(): RoutingTableAvailabilityView {
  return fixtureAvailability()
}

/** A check that found one model missing from the account and one model list it could not read. */
export function harnessCheckedAvailability(): RoutingTableAvailabilityView {
  return fixtureAvailability(
    {
      scientific_experiment_validation: {
        status: 'unavailable',
        reasons: ['model_not_listed'],
        awaitingUserConfirmation: false
      },
      fast_writing_or_alternative_draft: {
        status: 'unverified',
        reasons: ['model_list_unavailable'],
        awaitingUserConfirmation: false
      }
    },
    AVAILABLE
  )
}

export type CheckRoutesFixtureReply =
  | { ok: true; result: unknown; list: WorkbenchRoutingTableListResult }
  | { ok: false; code: string; message: string }

/** "Check routes": the readings stay in the page, so a later list shows them as main would. */
export function checkRoutesReply(
  list: WorkbenchRoutingTableListResult,
  failing: boolean
): CheckRoutesFixtureReply {
  if (failing) {
    return {
      ok: false,
      code: 'workbench_route_availability_unavailable',
      message: 'FIXTURE_ONLY route checks not installed'
    }
  }
  if (!list.active.ok) {
    return { ok: true, result: list.active, list }
  }
  const availability = harnessCheckedAvailability()
  return {
    ok: true,
    result: { ok: true, version: list.active.version, sha256: list.active.sha256, availability },
    list: { ...list, availability }
  }
}

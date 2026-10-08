// FIXTURE_ONLY: Routing Table views for the Settings tests, built from the shared document rows.
// Nothing here reads a store or calls a runtime; every hash is an obviously synthetic value.
import { buildTestRoutingTable } from '../../../../shared/routing-table/routing-table-document-rows.test-fixture'
import {
  RoutingTableEditSchema,
  type RoutingTableEdit
} from '../../../../shared/routing-table/routing-table-edit-schema'
import {
  RoutingTableSchema,
  type RoutingTable
} from '../../../../shared/routing-table/routing-table-schema'
import {
  ROUTING_TASK_TYPES,
  type RoutingTaskType
} from '../../../../shared/routing-table/routing-table-taxonomy'
import {
  RoutingTableAvailabilityViewSchema,
  type RouteAvailabilityView,
  type RoutingTableAvailabilityView
} from '../../../../shared/workbench-route-availability-view'
import {
  WorkbenchRoutingTableCheckResultSchema,
  WorkbenchRoutingTableListResultSchema,
  type WorkbenchRoutingTableCheckResult,
  type WorkbenchRoutingTableListResult
} from '../../../../shared/workbench-routing-table-view'

export const FIXTURE_SHA_V1 = '1'.repeat(64)
export const FIXTURE_SHA_V2 = '2'.repeat(64)
export const FIXTURE_SHA_V3 = '3'.repeat(64)
export const FIXTURE_SHA_V4 = '4'.repeat(64)

/** Version 3: the user's table, based on version 2. */
export function fixtureTable(overrides: Record<string, unknown> = {}): RoutingTable {
  return RoutingTableSchema.parse(
    buildTestRoutingTable({
      table_version: 3,
      source: 'user',
      based_on: { table_version: 2, sha256: FIXTURE_SHA_V2 },
      created_at: '2026-10-05T08:30:00Z',
      ...overrides
    })
  )
}

export function fixtureEdit(overrides: Record<string, unknown> = {}): RoutingTableEdit {
  return RoutingTableEditSchema.parse({
    base: { table_version: 3, sha256: FIXTURE_SHA_V3 },
    changes: [
      {
        task_type: 'software_engineering',
        execution_target: 'codex_cli',
        model: 'gpt-6-astra',
        reasoning_level: 'max'
      }
    ],
    ...overrides
  })
}

export function fixtureListResult(
  overrides: Partial<WorkbenchRoutingTableListResult> = {}
): WorkbenchRoutingTableListResult {
  return WorkbenchRoutingTableListResultSchema.parse({
    active: { ok: true, version: 3, sha256: FIXTURE_SHA_V3, source: 'user', table: fixtureTable() },
    availability: null,
    ...overrides
  })
}

const NOT_CHECKED: RouteAvailabilityView = {
  status: 'unverified',
  reasons: ['not_checked'],
  awaitingUserConfirmation: false
}
const AVAILABLE: RouteAvailabilityView = {
  status: 'available',
  reasons: [],
  awaitingUserConfirmation: false
}

/** Every route of the fixture table at one reading, with per-task-type exceptions. */
export function fixtureAvailability(
  byTaskType: Partial<Record<RoutingTaskType, RouteAvailabilityView>> = {},
  fallback: RouteAvailabilityView = NOT_CHECKED
): RoutingTableAvailabilityView {
  return RoutingTableAvailabilityViewSchema.parse({
    coordinator: fallback,
    routes: ROUTING_TASK_TYPES.map((taskType) => ({
      taskType,
      availability: byTaskType[taskType] ?? fallback
    })),
    reviewers: [fallback, fallback]
  })
}

/** A "Check now" answer for version 3: everything available except the given rows. */
export function fixtureCheckResult(
  byTaskType: Partial<Record<RoutingTaskType, RouteAvailabilityView>> = {}
): WorkbenchRoutingTableCheckResult {
  return WorkbenchRoutingTableCheckResultSchema.parse({
    ok: true,
    version: 3,
    sha256: FIXTURE_SHA_V3,
    availability: fixtureAvailability(byTaskType, AVAILABLE)
  })
}

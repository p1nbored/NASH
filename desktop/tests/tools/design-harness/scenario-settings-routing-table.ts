import {
  RoutingTableEditSchema,
  type RoutingTableChanges
} from '../../../src/shared/routing-table/routing-table-edit-schema'
import type { RoutingTable } from '../../../src/shared/routing-table/routing-table-schema'
import type {
  WorkbenchRoutingTableDecisionResult,
  WorkbenchRoutingTableListResult
} from '../../../src/shared/workbench-routing-table-view'
import { fixtureListResult } from '../../../src/renderer/src/components/settings/routing-table-view.test-fixture'
import {
  checkRoutesReply,
  harnessCheckedAvailability,
  harnessListedAvailability
} from './scenario-settings-route-availability'

// FIXTURE_ONLY: renderer settings capture state; no disk, CLI or network access.
export const ROUTING_TABLE_FIXTURE_VARIANTS = [
  'active',
  'empty',
  'damaged',
  'unavailable',
  'refusal',
  'checked',
  'checkFailed'
] as const
export type RoutingTableFixtureVariant = (typeof ROUTING_TABLE_FIXTURE_VARIANTS)[number]
export type SettingsFixtureReply =
  | { ok: true; result: unknown }
  | { ok: false; code: string; message: string }

export function readRoutingTableFixtureVariant(search: string): RoutingTableFixtureVariant {
  const value = new URLSearchParams(search).get('routingTable')
  return ROUTING_TABLE_FIXTURE_VARIANTS.find((variant) => variant === value) ?? 'active'
}

function fixtureSha(version: number): string {
  return String(version % 10).repeat(64)
}

function initialList(variant: RoutingTableFixtureVariant): WorkbenchRoutingTableListResult {
  if (variant === 'damaged') {
    return fixtureListResult({
      active: {
        ok: false,
        reason: 'routing_table_integrity_failed',
        detail: 'version_hash_mismatch'
      }
    })
  }
  return fixtureListResult({
    availability: variant === 'checked' ? harnessCheckedAvailability() : harnessListedAvailability()
  })
}

function applied(table: RoutingTable, change: RoutingTableChanges, version: number): RoutingTable {
  return {
    ...table,
    table_version: version,
    source: 'user',
    based_on: { table_version: table.table_version, sha256: fixtureSha(table.table_version) },
    created_at: '2026-10-05T10:00:00Z',
    coordinator: change.coordinator ?? table.coordinator,
    validation: change.validation ?? table.validation,
    routes: table.routes.map(
      (route) => change.changes.find((row) => row.task_type === route.task_type) ?? route
    )
  }
}

export function createRoutingTableFixture(
  variant: RoutingTableFixtureVariant
): (method: string, params: unknown) => SettingsFixtureReply | null {
  let list = initialList(variant)
  const save = (input: unknown): WorkbenchRoutingTableDecisionResult => {
    const parsed = RoutingTableEditSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, reason: 'invalid_table', detail: null }
    }
    if (!list.active.ok) {
      return list.active
    }
    const edit = parsed.data
    if (
      variant === 'refusal' ||
      edit.base.table_version !== list.active.version ||
      edit.base.sha256 !== list.active.sha256
    ) {
      return { ok: false, reason: 'base_not_active', detail: null }
    }
    const version = list.active.version + 1
    const sha256 = fixtureSha(version)
    list = {
      active: {
        ok: true,
        version,
        sha256,
        source: 'user',
        table: applied(list.active.table, edit, version)
      },
      availability: harnessListedAvailability()
    }
    return { ok: true, version, sha256 }
  }
  return (method, params) => {
    if (!method.startsWith('workbench.routingTable.')) {
      return null
    }
    if (variant === 'unavailable') {
      return { ok: false, code: 'method_not_found', message: 'Unknown method' }
    }
    switch (method) {
      case 'workbench.routingTable.list':
        return { ok: true, result: list }
      case 'workbench.routingTable.save':
        return { ok: true, result: save(params) }
      case 'workbench.routingTable.checkRoutes': {
        const reply = checkRoutesReply(list, variant === 'checkFailed')
        if (!reply.ok) {
          return reply
        }
        list = reply.list
        return { ok: true, result: reply.result }
      }
      default:
        return { ok: false, code: 'method_not_found', message: 'Unknown method' }
    }
  }
}

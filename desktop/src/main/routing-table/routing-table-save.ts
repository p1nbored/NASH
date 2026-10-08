import { RoutingTableEditSchema } from '../../shared/routing-table/routing-table-edit-schema'
import { RoutingTableSchema } from '../../shared/routing-table/routing-table-schema'
import {
  activateRoutingTable,
  listRoutingTableVersions,
  newestVersionNumber,
  resolveActiveRoutingTable,
  type ActivationResult
} from './routing-table-activation'
import { routingTableContentSha256 } from './routing-table-bundle'
import { isDesktopUserCaller, type RoutingTableContext } from './routing-table-context'
import { deriveRoutingTable } from './routing-table-derivation'

export type RoutingTableSaveResult =
  | ActivationResult
  | {
      readonly ok: false
      readonly reason: 'forbidden_caller' | 'invalid_table' | 'base_not_active' | 'no_change'
    }

/** A settings save commits directly; there is no pending proposal or separate approval. */
export function saveRoutingTable(
  ctx: RoutingTableContext,
  input: unknown,
  caller: unknown
): RoutingTableSaveResult {
  if (!isDesktopUserCaller(caller)) {
    return { ok: false, reason: 'forbidden_caller' }
  }
  const parsed = RoutingTableEditSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_table' }
  }
  const active = resolveActiveRoutingTable(ctx)
  if (!active.ok) {
    return active
  }
  const edit = parsed.data
  if (edit.base.table_version !== active.version || edit.base.sha256 !== active.sha256) {
    return { ok: false, reason: 'base_not_active' }
  }
  const versions = listRoutingTableVersions(ctx)
  if (!versions.ok) {
    return versions
  }
  const candidate = RoutingTableSchema.safeParse(
    deriveRoutingTable(active.table, {
      tableVersion: newestVersionNumber(versions.versions) + 1,
      source: 'user',
      basedOn: edit.base,
      createdAt: ctx.now().toISOString(),
      changes: edit.changes,
      ...(edit.coordinator ? { coordinator: edit.coordinator } : {}),
      ...(edit.validation ? { validation: edit.validation } : {})
    })
  )
  if (!candidate.success) {
    return { ok: false, reason: 'invalid_table' }
  }
  if (routingTableContentSha256(candidate.data) === routingTableContentSha256(active.table)) {
    return { ok: false, reason: 'no_change' }
  }
  return activateRoutingTable(ctx, { table: candidate.data })
}

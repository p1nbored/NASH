import {
  RoutingTableSchema,
  type RoutingTable
} from '../../shared/routing-table/routing-table-schema'
import { routingTableSha256 } from './routing-table-bundle'
import type { RoutingTableContext } from './routing-table-context'
import type { RoutingTableIndex, RoutingTableIndexEntry } from './routing-table-file-store'

/** Which version is active and how it changes: version file first, then the index (crash-safe order). */

export type IntegrityDetail =
  | 'index_missing'
  | 'index_unreadable'
  | 'index_invalid'
  | 'version_missing'
  | 'version_unreadable'
  | 'version_invalid'
  | 'version_hash_mismatch'

export type IntegrityFailure = {
  readonly ok: false
  readonly reason: 'routing_table_integrity_failed'
  readonly detail: IntegrityDetail
}
export type TaxonomyMismatch = {
  readonly ok: false
  readonly reason: 'routing_table_taxonomy_mismatch'
  readonly tableTaxonomyVersion: number
  readonly expectedTaxonomyVersion: number
}
export type ActiveRoutingTable =
  | {
      readonly ok: true
      readonly table: RoutingTable
      readonly version: number
      readonly sha256: string
      readonly source: 'bundled' | 'user'
    }
  | IntegrityFailure
  | TaxonomyMismatch
export type ResolvedRoutingTable =
  | ActiveRoutingTable
  | { readonly ok: false; readonly reason: 'routing_table_not_installed' }

type NotInstalled = { readonly ok: false; readonly reason: 'routing_table_not_installed' }
type UnknownVersion = { readonly ok: false; readonly reason: 'version_unknown' }
type VerifiedVersion =
  | { readonly ok: true; readonly table: RoutingTable; readonly entry: RoutingTableIndexEntry }
  | IntegrityFailure
  | UnknownVersion
type IndexRead =
  | { readonly ok: true; readonly index: RoutingTableIndex }
  | IntegrityFailure
  | NotInstalled
type ActiveVerification =
  | {
      readonly ok: true
      readonly index: RoutingTableIndex
      readonly table: RoutingTable
      readonly entry: RoutingTableIndexEntry
    }
  | IntegrityFailure
  | NotInstalled

const NOT_INSTALLED: NotInstalled = { ok: false, reason: 'routing_table_not_installed' }

function isNotInstalled(result: ResolvedRoutingTable): result is NotInstalled {
  return !result.ok && result.reason === 'routing_table_not_installed'
}

function integrityFailure(detail: IntegrityDetail): IntegrityFailure {
  return { ok: false, reason: 'routing_table_integrity_failed', detail }
}

function readIndex(ctx: RoutingTableContext): IndexRead {
  const read = ctx.store.readIndex()
  if (read.ok) {
    return { ok: true, index: read.value }
  }
  if (read.reason === 'missing') {
    // Why: an index that vanished next to version files is damage, not a first start.
    return ctx.store.hasAnyStoredFile() ? integrityFailure('index_missing') : NOT_INSTALLED
  }
  return integrityFailure(read.reason === 'unreadable' ? 'index_unreadable' : 'index_invalid')
}

/** Reads one indexed version and checks its hash against the index; a mismatch never falls back. */
function verifyVersion(
  ctx: RoutingTableContext,
  index: RoutingTableIndex,
  version: number
): VerifiedVersion {
  const entry = index.versions.find((candidate) => candidate.table_version === version)
  if (!entry) {
    return { ok: false, reason: 'version_unknown' }
  }
  const read = ctx.store.readVersion(version)
  if (!read.ok) {
    return integrityFailure(`version_${read.reason}`)
  }
  return routingTableSha256(read.value) === entry.sha256
    ? { ok: true, table: read.value, entry }
    : integrityFailure('version_hash_mismatch')
}

/** The number of the newest accepted version; the next version is one more. */
export function newestVersionNumber(versions: readonly RoutingTableIndexEntry[]): number {
  return versions.at(-1)?.table_version ?? 0
}

function taxonomyMismatch(ctx: RoutingTableContext, table: RoutingTable): TaxonomyMismatch | null {
  return table.taxonomy_version === ctx.expectedTaxonomyVersion
    ? null
    : {
        ok: false,
        reason: 'routing_table_taxonomy_mismatch',
        tableTaxonomyVersion: table.taxonomy_version,
        expectedTaxonomyVersion: ctx.expectedTaxonomyVersion
      }
}

/** Integrity of the index and the active version only; older versions never block routing. */
function verifyActive(ctx: RoutingTableContext): ActiveVerification {
  const read = readIndex(ctx)
  if (!read.ok) {
    return read
  }
  const verified = verifyVersion(ctx, read.index, read.index.active_version)
  if (verified.ok) {
    return { ok: true, index: read.index, table: verified.table, entry: verified.entry }
  }
  // Why: the index schema lists the active version, so an unknown one means a damaged index.
  return verified.reason === 'version_unknown' ? integrityFailure('index_invalid') : verified
}

/** The active table, or the reason there is none. Reads only; it never installs or repairs. */
export function resolveActiveRoutingTable(ctx: RoutingTableContext): ResolvedRoutingTable {
  const active = verifyActive(ctx)
  if (!active.ok) {
    return active
  }
  const mismatch = taxonomyMismatch(ctx, active.table)
  if (mismatch) {
    return mismatch
  }
  return {
    ok: true,
    table: active.table,
    version: active.entry.table_version,
    sha256: active.entry.sha256,
    source: active.entry.source
  }
}

function installBundledTable(ctx: RoutingTableContext): ActiveRoutingTable {
  const bundled = ctx.bundled()
  const parsed = RoutingTableSchema.safeParse({ ...bundled, table_version: 1 })
  if (!parsed.success) {
    throw new Error('The bundled routing table is invalid')
  }
  const table = parsed.data
  const mismatch = taxonomyMismatch(ctx, table)
  if (mismatch) {
    return mismatch
  }
  const sha256 = routingTableSha256(table)
  ctx.store.writeVersion(table)
  ctx.store.writeIndex({
    schema_version: 1,
    active_version: 1,
    bundled_version_seen: bundled.table_version,
    versions: [
      {
        table_version: 1,
        sha256,
        source: 'bundled',
        accepted_at: ctx.now().toISOString(),
        proposal_id: null
      }
    ]
  })
  return { ok: true, table, version: 1, sha256, source: 'bundled' }
}

/**
 * Startup: the active table, installing the bundled default as version 1 on the very first start
 * only. A damaged store is reported, never replaced, so routing stays blocked until it is recovered.
 */
export function ensureActiveRoutingTable(ctx: RoutingTableContext): ActiveRoutingTable {
  const resolved = resolveActiveRoutingTable(ctx)
  return isNotInstalled(resolved) ? installBundledTable(ctx) : resolved
}

export type ActivationRefusal =
  | IntegrityFailure
  | TaxonomyMismatch
  | NotInstalled
  | { readonly ok: false; readonly reason: 'invalid_table' }
  | { readonly ok: false; readonly reason: 'version_conflict' }
export type ActivationResult =
  | { readonly ok: true; readonly version: number; readonly sha256: string }
  | ActivationRefusal

/** Version file first, then the index: a crash between them leaves the old version active. */
function commitNextVersion(
  ctx: RoutingTableContext,
  index: RoutingTableIndex,
  candidate: RoutingTable
): ActivationResult {
  const parsed = RoutingTableSchema.safeParse(candidate)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_table' }
  }
  const table = parsed.data
  const mismatch = taxonomyMismatch(ctx, table)
  if (mismatch) {
    return mismatch
  }
  if (table.table_version !== newestVersionNumber(index.versions) + 1) {
    return { ok: false, reason: 'version_conflict' }
  }
  const sha256 = routingTableSha256(table)
  ctx.store.writeVersion(table)
  ctx.store.writeIndex({
    ...index,
    active_version: table.table_version,
    versions: [
      ...index.versions,
      {
        table_version: table.table_version,
        sha256,
        source: table.source,
        accepted_at: ctx.now().toISOString(),
        proposal_id: null
      }
    ]
  })
  return { ok: true, version: table.table_version, sha256 }
}

/** Activates a validated table as the next version; callers have already checked who may ask. */
export function activateRoutingTable(
  ctx: RoutingTableContext,
  input: { table: RoutingTable }
): ActivationResult {
  const active = verifyActive(ctx)
  if (!active.ok) {
    return active
  }
  return commitNextVersion(ctx, active.index, input.table)
}

export type VersionListing =
  | {
      readonly ok: true
      readonly activeVersion: number
      readonly versions: readonly RoutingTableIndexEntry[]
    }
  | IntegrityFailure
  | NotInstalled

/** Stored version metadata for numbering the next save; reads only the index. */
export function listRoutingTableVersions(ctx: RoutingTableContext): VersionListing {
  const read = readIndex(ctx)
  return read.ok
    ? { ok: true, activeVersion: read.index.active_version, versions: read.index.versions }
    : read
}

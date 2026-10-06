import { createHash } from 'node:crypto'
import { canonicalJson } from '../../shared/canonical-json'
import {
  RoutingTableSchema,
  type RoutingTable
} from '../../shared/routing-table/routing-table-schema'
import defaultTable from './default-routing-table.json'

/** The bundled default plus the table's text form and identity (hashes), shared by every store module. */

// Why a cap: a table file is read whole on the main thread and may have been edited by another process.
export const ROUTING_TABLE_MAX_FILE_BYTES = 64 * 1024

export type RoutingTableParse =
  | { readonly ok: true; readonly table: RoutingTable }
  | { readonly ok: false; readonly error: string }

/** Validates whole: a text that fails any check is rejected, never partly applied. */
export function parseRoutingTableText(text: string): RoutingTableParse {
  if (Buffer.byteLength(text, 'utf8') > ROUTING_TABLE_MAX_FILE_BYTES) {
    return { ok: false, error: 'too_large' }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid_json' }
  }
  const parsed = RoutingTableSchema.safeParse(json)
  if (parsed.success) {
    return { ok: true, table: parsed.data }
  }
  // Why only the path: an issue message could echo table content into logs.
  const path = parsed.error.issues[0]?.path.join('.') ?? ''
  return { ok: false, error: `schema_invalid: ${path}` }
}

function sha256Hex(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

/** Integrity identity: the canonical hash of the whole table, version envelope included. */
export function routingTableSha256(table: RoutingTable): string {
  return sha256Hex(table)
}

/** Policy identity: the same for any two versions that route, validate and describe identically. */
export function routingTableContentSha256(table: RoutingTable): string {
  return sha256Hex({
    taxonomy_version: table.taxonomy_version,
    coordinator: table.coordinator,
    routes: table.routes,
    validation: table.validation
  })
}

/** The file text of a version: readable, with the hash taken from the parsed table instead. */
export function routingTableFileText(table: RoutingTable): string {
  return `${JSON.stringify(table, null, 2)}\n`
}

/** The default policy this build ships; a build whose JSON fails the schema must not start. */
export function getBundledRoutingTable(): RoutingTable {
  const parsed = RoutingTableSchema.safeParse(defaultTable)
  if (!parsed.success) {
    throw new Error('The bundled routing table is invalid')
  }
  return parsed.data
}

// FIXTURE_ONLY: wires the routing-table stores to the in-memory file system and a stepping clock.
import { join } from 'node:path'
import {
  buildTestRoutingTable,
  type TestTableInput
} from '../../shared/routing-table/routing-table-document-rows.test-fixture'
import {
  RoutingTableSchema,
  type RoutingTable
} from '../../shared/routing-table/routing-table-schema'
import { createRoutingTableContext, type RoutingTableContext } from './routing-table-context'
import { ROUTING_TABLE_DIR_NAME } from './routing-table-file-store'
import {
  createMemoryRoutingTableFs,
  type MemoryRoutingTableFs
} from './routing-table-memory-fs.test-fixture'

export const FIXTURE_USER_DATA = 'fixture-user-data'
export const FIXTURE_TABLE_DIR = join(FIXTURE_USER_DATA, ROUTING_TABLE_DIR_NAME)
const FIXTURE_START_MS = Date.parse('2026-10-04T12:00:00Z')
const FIXTURE_STEP_MS = 60_000

export type TestRoutingTableEnvironment = {
  readonly ctx: RoutingTableContext
  readonly fs: MemoryRoutingTableFs
}

export function createTestRoutingTableEnvironment(
  options: {
    fs?: MemoryRoutingTableFs
    expectedTaxonomyVersion?: number
    bundled?: RoutingTable
  } = {}
): TestRoutingTableEnvironment {
  const fs = options.fs ?? createMemoryRoutingTableFs()
  const { bundled } = options
  let ticks = 0
  let ids = 0
  const ctx = createRoutingTableContext({
    paths: { getUserDataPath: () => FIXTURE_USER_DATA },
    fs,
    now: () => new Date(FIXTURE_START_MS + FIXTURE_STEP_MS * ticks++),
    newProposalId: () => `proposal-${String(++ids).padStart(4, '0')}`,
    ...(options.expectedTaxonomyVersion === undefined
      ? {}
      : { expectedTaxonomyVersion: options.expectedTaxonomyVersion }),
    ...(bundled ? { bundled: () => bundled } : {})
  })
  return { ctx, fs }
}

/** A parsed table built from the document rows with top-level fields replaced. */
export function parsedTestTable(overrides: TestTableInput = {}): RoutingTable {
  return RoutingTableSchema.parse(buildTestRoutingTable(overrides))
}

export function versionFilePath(version: number): string {
  return join(FIXTURE_TABLE_DIR, 'versions', `v${String(version).padStart(4, '0')}.json`)
}

export const INDEX_FILE_PATH = join(FIXTURE_TABLE_DIR, 'index.json')

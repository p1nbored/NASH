import { randomUUID } from 'node:crypto'
import { ROUTING_TAXONOMY_VERSION } from '../../shared/routing-table/routing-table-taxonomy'
import type { RoutingTable } from '../../shared/routing-table/routing-table-schema'
import { getBundledRoutingTable } from './routing-table-bundle'
import {
  createRoutingTableFileStore,
  type RoutingTableFileStore,
  type RoutingTableFs,
  type RoutingTablePathPort
} from './routing-table-file-store'

/** Everything the activation and proposal functions need, built from ports so tests inject fakes. */
export type RoutingTableContext = {
  readonly store: RoutingTableFileStore
  readonly now: () => Date
  /** The classifier bundle's taxonomy; a table of another taxonomy is refused. */
  readonly expectedTaxonomyVersion: number
  /** The default table this build ships. */
  readonly bundled: () => RoutingTable
  readonly newProposalId: () => string
}

export function createRoutingTableContext(options: {
  paths: RoutingTablePathPort
  fs: RoutingTableFs
  now?: () => Date
  expectedTaxonomyVersion?: number
  bundled?: () => RoutingTable
  newProposalId?: () => string
}): RoutingTableContext {
  return {
    store: createRoutingTableFileStore({ paths: options.paths, fs: options.fs }),
    now: options.now ?? (() => new Date()),
    expectedTaxonomyVersion: options.expectedTaxonomyVersion ?? ROUTING_TAXONOMY_VERSION,
    bundled: options.bundled ?? getBundledRoutingTable,
    newProposalId: options.newProposalId ?? (() => randomUUID())
  }
}

/** Only the desktop user may decide. The value arrives untyped from RPC, so it is checked at runtime. */
export function isDesktopUserCaller(caller: unknown): boolean {
  return caller === 'desktop_user'
}

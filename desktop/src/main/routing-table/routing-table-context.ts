import { ROUTING_TAXONOMY_VERSION } from '../../shared/routing-table/routing-table-taxonomy'
import type { RoutingTable } from '../../shared/routing-table/routing-table-schema'
import { getBundledRoutingTable } from './routing-table-bundle'
import {
  createRoutingTableFileStore,
  type RoutingTableFileStore,
  type RoutingTableFs,
  type RoutingTablePathPort
} from './routing-table-file-store'

/** Everything the activation and saving need, built from ports so tests inject fakes. */
export type RoutingTableContext = {
  readonly store: RoutingTableFileStore
  readonly now: () => Date
  /** The classifier bundle's taxonomy; a table of another taxonomy is refused. */
  readonly expectedTaxonomyVersion: number
  /** The default table this build ships. */
  readonly bundled: () => RoutingTable
}

export function createRoutingTableContext(options: {
  paths: RoutingTablePathPort
  fs: RoutingTableFs
  now?: () => Date
  expectedTaxonomyVersion?: number
  bundled?: () => RoutingTable
}): RoutingTableContext {
  return {
    store: createRoutingTableFileStore({ paths: options.paths, fs: options.fs }),
    now: options.now ?? (() => new Date()),
    expectedTaxonomyVersion: options.expectedTaxonomyVersion ?? ROUTING_TAXONOMY_VERSION,
    bundled: options.bundled ?? getBundledRoutingTable
  }
}

/** Only the desktop user may decide. The value arrives untyped from RPC, so it is checked at runtime. */
export function isDesktopUserCaller(caller: unknown): boolean {
  return caller === 'desktop_user'
}

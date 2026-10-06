import { renameSync, statSync } from 'node:fs'
import { createNodeRoutingTableFs, type RoutingTableFs } from '../routing-table-file-store'

/** The routing-table file port plus what the latch file needs to quarantine a damaged copy. */
export type AvailabilityFs = RoutingTableFs & {
  /** Moves a file. Used only to set a damaged latch file aside; nothing here deletes a file. */
  renameFile(from: string, to: string): void
  /** Last modification time in milliseconds; throws when the file cannot be read. */
  modifiedAtMs(path: string): number
}

export function createNodeAvailabilityFs(): AvailabilityFs {
  return {
    ...createNodeRoutingTableFs(),
    renameFile: (from, to) => renameSync(from, to),
    modifiedAtMs: (path) => statSync(path).mtimeMs
  }
}

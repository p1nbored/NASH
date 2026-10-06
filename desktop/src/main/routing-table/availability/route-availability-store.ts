import { join } from 'node:path'
import { ROUTING_TABLE_DIR_NAME, type RoutingTablePathPort } from '../routing-table-file-store'
import type { ModelListing } from './model-listing'
import type { AvailabilityFs } from './route-availability-fs'
import type { LatchKind, RouteLatch, RouteProvider } from './route-availability-types'
import type { AgentDetectionReading } from './route-cli-detection-check'
import {
  LATCH_FILE_NAME,
  MAX_CLEARED_ROUTES,
  MAX_LATCHES,
  findUnrecordedDamage,
  latchFileText,
  quarantineLatchFile,
  readLatchFile,
  type ClearedRoute,
  type DamagedState
} from './route-latch-file'

/**
 * What availability remembers between evaluations. The listings and the detection are only held in
 * memory (they are rebuilt by asking again); the latches are the one fact that cannot be rebuilt, so
 * they go to `availability.json` beside the routing table (not part of any hash).
 *
 * A latch file that is damaged or unreadable never means "no latches": it is set aside, and every route
 * then counts as latched since the file was last written, until a re-check clears it route by route.
 */

export { MAX_CLEARED_ROUTES, MAX_LATCHES }
export type { LatchKind, RouteLatch }

const LATCH_KINDS: readonly LatchKind[] = ['auth', 'quota']

export type CachedDetection = {
  readonly reading: AgentDetectionReading
  readonly observedAtMs: number
}

export type RouteAvailabilityStore = {
  getListing(provider: RouteProvider): ModelListing | null
  putListing(provider: RouteProvider, listing: ModelListing): void
  getDetection(): CachedDetection | null
  putDetection(reading: AgentDetectionReading, observedAtMs: number): void
  /** Forgets every cached listing and the detection (an account or login changed); latches stay. */
  clearObservations(): void
  latchesFor(routeKey: string): readonly RouteLatch[]
  addLatch(latch: RouteLatch): void
  clearLatch(routeKey: string, kind: LatchKind): void
  /** True when the latch file could not be saved; the latches are still held in memory. */
  persistenceFailed(): boolean
}

function isCleared(damaged: DamagedState, routeKey: string, kind: LatchKind): boolean {
  return damaged.cleared.some((entry) => entry.routeKey === routeKey && entry.kind === kind)
}

export function createRouteAvailabilityStore(options: {
  paths: RoutingTablePathPort
  fs: AvailabilityFs
  now: () => number
}): RouteAvailabilityStore {
  const { paths, fs } = options
  const directory = (): string => join(paths.getUserDataPath(), ROUTING_TABLE_DIR_NAME)
  const filePath = (): string => join(directory(), LATCH_FILE_NAME)
  const listings = new Map<RouteProvider, ModelListing>()
  let detection: CachedDetection | null = null
  let latches: readonly RouteLatch[] = []
  let damaged: DamagedState | null = null
  let writeFailed = false
  // Why: while the damaged file could not be moved aside, a write would replace (delete) it.
  let writesBlocked = false

  function persist(): void {
    if (writesBlocked) {
      writeFailed = true
      return
    }
    try {
      fs.ensureDir(directory())
      fs.writeFileAtomically(filePath(), latchFileText({ latches, damaged }))
      writeFailed = false
    } catch {
      writeFailed = true
    }
  }

  /** When the damaged file was last written; the current time if that cannot be read. */
  function lastWrittenAtMs(): number {
    try {
      const time = fs.modifiedAtMs(filePath())
      if (Number.isFinite(time) && time >= 0) {
        return Math.floor(time)
      }
    } catch {
      // Why now: with no modification time, only a reading newer than this moment can clear a route.
    }
    return options.now()
  }

  function startUp(): void {
    const read = readLatchFile(fs, filePath())
    if (read.status === 'ok') {
      latches = read.state.latches
      damaged = read.state.damaged
      return
    }
    if (read.status === 'missing') {
      // Why look: a copy set aside with no new file means the damage was never recorded.
      const unrecorded = findUnrecordedDamage(fs, directory())
      if (unrecorded !== null) {
        damaged = { sinceMs: unrecorded.atMs ?? options.now(), cleared: [] }
        persist()
      }
      return
    }
    damaged = { sinceMs: lastWrittenAtMs(), cleared: [] }
    if (quarantineLatchFile(fs, directory(), options.now())) {
      persist()
    } else {
      writesBlocked = true
      writeFailed = true
    }
  }

  startUp()

  return {
    getListing: (provider) => listings.get(provider) ?? null,
    putListing(provider, listing) {
      listings.set(provider, listing)
    },
    getDetection: () => detection,
    putDetection(reading, observedAtMs) {
      detection = { reading, observedAtMs }
    },
    clearObservations() {
      listings.clear()
      detection = null
    },
    latchesFor(routeKey) {
      const own = latches.filter((entry) => entry.routeKey === routeKey)
      const lost = damaged
      if (lost === null) {
        return own
      }
      // Why stand-ins: the lost latches may have been of either kind, so each kind holds until cleared.
      const standIns = LATCH_KINDS.filter(
        (kind) => !own.some((entry) => entry.kind === kind) && !isCleared(lost, routeKey, kind)
      ).map((kind): RouteLatch => ({
        routeKey,
        kind,
        latchedAtMs: lost.sinceMs,
        source: 'availability_file_damaged'
      }))
      return [...own, ...standIns]
    },
    addLatch(latch) {
      const kept = latches.filter(
        (entry) => !(entry.routeKey === latch.routeKey && entry.kind === latch.kind)
      )
      const next = [...kept, latch]
      // Why evict rather than refuse: a new executor failure must always be held.
      const oldest =
        next.length > MAX_LATCHES
          ? next.reduce((a, b) => (b.latchedAtMs < a.latchedAtMs ? b : a))
          : null
      latches = oldest === null ? next : next.filter((entry) => entry !== oldest)
      persist()
    },
    clearLatch(routeKey, kind) {
      const remaining = latches.filter(
        (entry) => !(entry.routeKey === routeKey && entry.kind === kind)
      )
      let changed = remaining.length !== latches.length
      if (damaged !== null && !isCleared(damaged, routeKey, kind)) {
        const cleared: readonly ClearedRoute[] = [...damaged.cleared, { routeKey, kind }]
        // Why drop the oldest: a route that falls off the list is latched again, which fails closed.
        damaged = { ...damaged, cleared: cleared.slice(-MAX_CLEARED_ROUTES) }
        changed = true
      }
      if (changed) {
        latches = remaining
        persist()
      }
    },
    persistenceFailed: () => writeFailed
  }
}

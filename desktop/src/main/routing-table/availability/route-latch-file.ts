import { join } from 'node:path'
import { z } from 'zod'
import type { AvailabilityFs } from './route-availability-fs'
import type { LatchKind, RouteLatch } from './route-availability-types'

/** The shape of `availability.json`: the executor-reported latches, and a record of lost latch state. */

export const MAX_LATCHES = 64
export const MAX_CLEARED_ROUTES = 256
// Why a cap: the file is read whole on the main thread and may have been edited by another process.
const MAX_FILE_BYTES = 256 * 1024
export const LATCH_FILE_NAME = 'availability.json'
export const QUARANTINE_MARKER = `${LATCH_FILE_NAME}.damaged-`

export type ClearedRoute = { readonly routeKey: string; readonly kind: LatchKind }

/** Set after a damaged file: every route counts as latched since then, until it is cleared one by one. */
export type DamagedState = { readonly sinceMs: number; readonly cleared: readonly ClearedRoute[] }

export type LatchFileState = {
  readonly latches: readonly RouteLatch[]
  readonly damaged: DamagedState | null
}

const KindSchema = z.enum(['auth', 'quota'])
const RouteKeySchema = z.string().min(1).max(300)

const FileSchema = z
  .object({
    schema_version: z.literal(1),
    latches: z
      .array(
        z
          .object({
            route_key: RouteKeySchema,
            kind: KindSchema,
            latched_at_ms: z.number().int().min(0)
          })
          .strict()
      )
      .max(MAX_LATCHES),
    damaged: z
      .object({
        since_ms: z.number().int().min(0),
        cleared: z
          .array(z.object({ route_key: RouteKeySchema, kind: KindSchema }).strict())
          .max(MAX_CLEARED_ROUTES)
      })
      .strict()
      .optional()
  })
  .strict()

export type LatchFileRead =
  | { readonly status: 'missing' }
  | { readonly status: 'ok'; readonly state: LatchFileState }
  /** Present but unreadable, too large, not JSON, or not this schema. */
  | { readonly status: 'damaged' }

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export function readLatchFile(fs: AvailabilityFs, path: string): LatchFileRead {
  let text: string
  try {
    text = fs.readFile(path)
  } catch (error) {
    return isMissingFileError(error) ? { status: 'missing' } : { status: 'damaged' }
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    return { status: 'damaged' }
  }
  try {
    const parsed = FileSchema.safeParse(JSON.parse(text))
    if (!parsed.success) {
      return { status: 'damaged' }
    }
    const { latches, damaged } = parsed.data
    return {
      status: 'ok',
      state: {
        latches: latches.map((entry) => ({
          routeKey: entry.route_key,
          kind: entry.kind,
          latchedAtMs: entry.latched_at_ms
        })),
        damaged: damaged
          ? {
              sinceMs: damaged.since_ms,
              cleared: damaged.cleared.map((entry) => ({
                routeKey: entry.route_key,
                kind: entry.kind
              }))
            }
          : null
      }
    }
  } catch {
    return { status: 'damaged' }
  }
}

export function latchFileText(state: LatchFileState): string {
  const body = {
    schema_version: 1,
    latches: state.latches.map((entry) => ({
      route_key: entry.routeKey,
      kind: entry.kind,
      latched_at_ms: entry.latchedAtMs
    })),
    ...(state.damaged
      ? {
          damaged: {
            since_ms: state.damaged.sinceMs,
            cleared: state.damaged.cleared.map((entry) => ({
              route_key: entry.routeKey,
              kind: entry.kind
            }))
          }
        }
      : {})
  }
  return `${JSON.stringify(body, null, 2)}\n`
}

/** Sets the damaged file aside as `availability.json.damaged-<timestamp>`; an earlier copy is never overwritten. */
export function quarantineLatchFile(fs: AvailabilityFs, directory: string, nowMs: number): boolean {
  try {
    const taken = new Set(fs.listFileNames(directory))
    const stamp = new Date(Number.isFinite(nowMs) ? nowMs : 0).toISOString().replace(/[:.]/g, '-')
    let name = `${QUARANTINE_MARKER}${stamp}`
    for (let attempt = 1; taken.has(name); attempt += 1) {
      name = `${QUARANTINE_MARKER}${stamp}-${attempt}`
    }
    fs.renameFile(join(directory, LATCH_FILE_NAME), join(directory, name))
    return true
  } catch {
    return false
  }
}

/**
 * Looks for a quarantined copy with no latch file beside it, which means the damage was set aside but
 * never recorded. Null when there is none; otherwise the newest copy's modification time (null if unreadable).
 */
export function findUnrecordedDamage(
  fs: AvailabilityFs,
  directory: string
): { readonly atMs: number | null } | null {
  const names = fs.listFileNames(directory).filter((name) => name.startsWith(QUARANTINE_MARKER))
  if (names.length === 0) {
    return null
  }
  const times = names.flatMap((name) => {
    try {
      const time = fs.modifiedAtMs(join(directory, name))
      return Number.isFinite(time) ? [Math.floor(time)] : []
    } catch {
      return []
    }
  })
  return { atMs: times.length === 0 ? null : Math.max(...times) }
}

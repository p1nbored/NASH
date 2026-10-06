// FIXTURE_ONLY: an in-memory file system with rename and modification times for the availability store.
import {
  createMemoryRoutingTableFs,
  type MemoryRoutingTableFs
} from '../routing-table-memory-fs.test-fixture'
import type { AvailabilityFs } from './route-availability-fs'

export type MemoryAvailabilityFs = AvailabilityFs &
  MemoryRoutingTableFs & {
    /** Modification time of each file; tests may seed or change it. */
    readonly mtimes: Map<string, number>
    /** Paths whose reads fail with a permission error. */
    readonly unreadable: Set<string>
    readonly failures: { rename: boolean; modifiedAt: boolean }
    /** Puts a file in place with the given modification time. */
    seed(path: string, text: string, mtimeMs: number): void
  }

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

export function createMemoryAvailabilityFs(clock: () => number): MemoryAvailabilityFs {
  const base = createMemoryRoutingTableFs()
  const mtimes = new Map<string, number>()
  const unreadable = new Set<string>()
  const failures = { rename: false, modifiedAt: false }
  return {
    ...base,
    mtimes,
    unreadable,
    failures,
    readFile(path) {
      if (unreadable.has(path)) {
        throw codedError(`EACCES: permission denied, open '${path}'`, 'EACCES')
      }
      return base.readFile(path)
    },
    writeFileAtomically(path, data) {
      base.writeFileAtomically(path, data)
      mtimes.set(path, clock())
    },
    renameFile(from, to) {
      const text = base.files.get(from)
      if (failures.rename || text === undefined) {
        throw codedError(`EPERM: cannot rename '${from}'`, 'EPERM')
      }
      base.files.set(to, text)
      base.files.delete(from)
      const mtime = mtimes.get(from)
      if (mtime !== undefined) {
        mtimes.set(to, mtime)
      }
      mtimes.delete(from)
    },
    modifiedAtMs(path) {
      const mtime = mtimes.get(path)
      if (failures.modifiedAt || mtime === undefined) {
        throw codedError(`ENOENT: no such file '${path}'`, 'ENOENT')
      }
      return mtime
    },
    seed(path, text, mtimeMs) {
      base.files.set(path, text)
      mtimes.set(path, mtimeMs)
    }
  }
}

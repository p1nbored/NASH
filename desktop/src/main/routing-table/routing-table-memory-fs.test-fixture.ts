// FIXTURE_ONLY: an in-memory file system for the routing-table stores; nothing touches the disk.
import { dirname } from 'node:path'
import type { RoutingTableFs } from './routing-table-file-store'

export type MemoryRoutingTableFs = RoutingTableFs & {
  /** Current files by path. Tests may seed or corrupt entries directly. */
  readonly files: Map<string, string>
  /** Every atomic write in order, so tests can assert the crash-safe write order. */
  readonly writeLog: string[]
  readonly ensuredDirs: string[]
  /** Makes writes to matching paths throw once, like a crash between two writes. */
  failNextWriteMatching(pattern: RegExp): void
}

function missingFileError(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' })
}

export function createMemoryRoutingTableFs(): MemoryRoutingTableFs {
  const files = new Map<string, string>()
  const writeLog: string[] = []
  const ensuredDirs: string[] = []
  let pendingFailure: RegExp | null = null

  return {
    files,
    writeLog,
    ensuredDirs,
    failNextWriteMatching(pattern) {
      pendingFailure = pattern
    },
    readFile(path) {
      const text = files.get(path)
      if (text === undefined) {
        throw missingFileError(path)
      }
      return text
    },
    writeFileAtomically(path, data) {
      if (pendingFailure?.test(path)) {
        pendingFailure = null
        throw new Error(`simulated write failure for ${path}`)
      }
      files.set(path, data)
      writeLog.push(path)
    },
    ensureDir(path) {
      ensuredDirs.push(path)
    },
    listFileNames(directory) {
      return [...files.keys()]
        .filter((path) => dirname(path) === directory)
        .map((path) => path.slice(directory.length + 1))
    }
  }
}

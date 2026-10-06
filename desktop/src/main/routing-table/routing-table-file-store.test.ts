import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getBundledRoutingTable, routingTableSha256 } from './routing-table-bundle'
import {
  ROUTING_TABLE_DIR_NAME,
  createNodeRoutingTableFs,
  createRoutingTableFileStore,
  RoutingTableIndexSchema,
  type RoutingTableIndex
} from './routing-table-file-store'
import { createMemoryRoutingTableFs } from './routing-table-memory-fs.test-fixture'

const USER_DATA = join('injected-user-data', 'profile')
const TABLE_DIR = join(USER_DATA, ROUTING_TABLE_DIR_NAME)

function newStore() {
  const fs = createMemoryRoutingTableFs()
  const store = createRoutingTableFileStore({ paths: { getUserDataPath: () => USER_DATA }, fs })
  return { fs, store }
}

function indexWith(overrides: Record<string, unknown> = {}): RoutingTableIndex {
  const sha256 = routingTableSha256(getBundledRoutingTable())
  return RoutingTableIndexSchema.parse({
    schema_version: 1,
    active_version: 1,
    bundled_version_seen: 1,
    versions: [
      {
        table_version: 1,
        sha256,
        source: 'bundled',
        accepted_at: '2026-10-04T12:00:00Z',
        proposal_id: null
      }
    ],
    ...overrides
  })
}

describe('where the files live', () => {
  it('puts everything under the injected user data folder and nowhere else', () => {
    const { fs, store } = newStore()
    store.writeIndex(indexWith())
    store.writeVersion({ ...getBundledRoutingTable() })
    expect(store.directory).toBe(TABLE_DIR)
    expect(fs.writeLog.length).toBe(2)
    for (const path of fs.writeLog) {
      expect(path.startsWith(`${TABLE_DIR}${sep}`)).toBe(true)
    }
    for (const path of fs.ensuredDirs) {
      expect(path.startsWith(TABLE_DIR)).toBe(true)
    }
  })

  it('asks the path port every time, so a changed user data folder is followed', () => {
    const fs = createMemoryRoutingTableFs()
    let root = join('first-root')
    const store = createRoutingTableFileStore({ paths: { getUserDataPath: () => root }, fs })
    store.writeIndex(indexWith())
    root = join('second-root')
    store.writeIndex(indexWith())
    expect(fs.writeLog.map((path) => path.split(/[\\/]/)[0])).toEqual(['first-root', 'second-root'])
  })
})

describe('the index file', () => {
  it('reports a missing index, an unreadable one and an invalid one separately', () => {
    const { fs, store } = newStore()
    expect(store.readIndex()).toEqual({ ok: false, reason: 'missing' })
    fs.files.set(join(TABLE_DIR, 'index.json'), '{broken')
    expect(store.readIndex()).toEqual({ ok: false, reason: 'invalid' })
    fs.files.set(join(TABLE_DIR, 'index.json'), JSON.stringify({ schema_version: 1 }))
    expect(store.readIndex()).toEqual({ ok: false, reason: 'invalid' })
  })

  it('reports an I/O error other than not-found as unreadable instead of throwing', () => {
    const { fs, store } = newStore()
    fs.readFile = () => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    }
    expect(store.readIndex()).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('round-trips a valid index', () => {
    const { store } = newStore()
    const index = indexWith()
    store.writeIndex(index)
    expect(store.readIndex()).toEqual({ ok: true, value: index })
  })

  it('refuses an index that names an active version it does not list', () => {
    const { fs, store } = newStore()
    const bad = { ...indexWith(), active_version: 2 }
    fs.files.set(join(TABLE_DIR, 'index.json'), JSON.stringify(bad))
    expect(store.readIndex()).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses versions that are not strictly ascending', () => {
    const { fs, store } = newStore()
    const entry = indexWith().versions[0]
    const bad = { ...indexWith(), versions: [entry, entry] }
    fs.files.set(join(TABLE_DIR, 'index.json'), JSON.stringify(bad))
    expect(store.readIndex()).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses an oversized index file', () => {
    const { fs, store } = newStore()
    fs.files.set(join(TABLE_DIR, 'index.json'), ' '.repeat(300 * 1024))
    expect(store.readIndex()).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses to write an invalid index', () => {
    const { fs, store } = newStore()
    expect(() => store.writeIndex({ ...indexWith(), active_version: 9 })).toThrow()
    expect(fs.writeLog).toEqual([])
  })
})

describe('version files', () => {
  it('names them v0001.json, zero padded, under versions/', () => {
    const { fs, store } = newStore()
    store.writeVersion(getBundledRoutingTable())
    store.writeVersion({ ...getBundledRoutingTable(), table_version: 12 })
    expect(fs.writeLog).toEqual([
      join(TABLE_DIR, 'versions', 'v0001.json'),
      join(TABLE_DIR, 'versions', 'v0012.json')
    ])
  })

  it('reads back what it wrote and reports missing, invalid and mismatched files', () => {
    const { fs, store } = newStore()
    const table = getBundledRoutingTable()
    store.writeVersion(table)
    expect(store.readVersion(1)).toEqual({ ok: true, value: table })
    expect(store.readVersion(2)).toEqual({ ok: false, reason: 'missing' })
    fs.files.set(join(TABLE_DIR, 'versions', 'v0001.json'), '{"schema_version":1}')
    expect(store.readVersion(1)).toEqual({ ok: false, reason: 'invalid' })
    store.writeVersion(table)
    fs.files.set(
      join(TABLE_DIR, 'versions', 'v0003.json'),
      fs.files.get(join(TABLE_DIR, 'versions', 'v0001.json')) ?? ''
    )
    expect(store.readVersion(3)).toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([0, -1, 1.5, Number.NaN])(
    'refuses the version number %s without touching a file',
    (version) => {
      const { fs, store } = newStore()
      expect(store.readVersion(version)).toEqual({ ok: false, reason: 'invalid' })
      expect(fs.writeLog).toEqual([])
    }
  )

  it('refuses to write a table that fails the schema', () => {
    const { fs, store } = newStore()
    expect(() => store.writeVersion({ ...getBundledRoutingTable(), routes: [] })).toThrow()
    expect(fs.writeLog).toEqual([])
  })

  it('knows whether any version or index file exists, for the first-start decision', () => {
    const { fs, store } = newStore()
    expect(store.hasAnyStoredFile()).toBe(false)
    fs.files.set(join(TABLE_DIR, 'versions', 'v0001.json'), '{}')
    expect(store.hasAnyStoredFile()).toBe(true)
  })
})

describe('proposal files', () => {
  it('lists only well-formed proposal file names', () => {
    const { fs, store } = newStore()
    for (const name of [
      'proposal-0001.json',
      'bundled-v2.json',
      'notes.txt',
      '.hidden.json',
      'a.json'
    ]) {
      fs.files.set(join(TABLE_DIR, 'proposals', name), '{}')
    }
    expect(store.listProposalIds().sort()).toEqual(['bundled-v2', 'proposal-0001'])
  })

  it.each(['../index', '..\\index', 'a/b/c/d/e/f/g/h', '', 'short', 'x'.repeat(65)])(
    'never builds a path from the id %j',
    (id) => {
      const { fs, store } = newStore()
      expect(store.readProposal(id)).toEqual({ ok: false, reason: 'invalid' })
      expect(fs.writeLog).toEqual([])
    }
  )

  it('reports a missing proposal file', () => {
    expect(newStore().store.readProposal('proposal-0001')).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('the node file system adapter', () => {
  const folders: string[] = []
  afterEach(() => {
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('creates folders, writes atomically, reads, and lists a folder that may not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'routing-table-fs-'))
    folders.push(root)
    const fs = createNodeRoutingTableFs()
    const dir = join(root, 'nested', 'folder')
    expect(fs.listFileNames(dir)).toEqual([])
    fs.ensureDir(dir)
    fs.writeFileAtomically(join(dir, 'a.json'), '{"a":1}')
    fs.writeFileAtomically(join(dir, 'a.json'), '{"a":2}')
    expect(fs.readFile(join(dir, 'a.json'))).toBe('{"a":2}')
    expect(fs.listFileNames(dir)).toEqual(['a.json'])
  })

  it('throws an ENOENT error for a missing file, which the store reads as missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'routing-table-fs-'))
    folders.push(root)
    const store = createRoutingTableFileStore({
      paths: { getUserDataPath: () => root },
      fs: createNodeRoutingTableFs()
    })
    expect(store.readIndex()).toEqual({ ok: false, reason: 'missing' })
    mkdirSync(join(root, ROUTING_TABLE_DIR_NAME), { recursive: true })
    writeFileSync(join(root, ROUTING_TABLE_DIR_NAME, 'index.json'), 'not json')
    expect(store.readIndex()).toEqual({ ok: false, reason: 'invalid' })
  })
})

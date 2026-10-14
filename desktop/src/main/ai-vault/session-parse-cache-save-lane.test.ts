import * as fsPromises from 'node:fs/promises'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  ensureSessionParseCacheLoaded,
  flushSessionParseCachePersist,
  initSessionParseCachePersistence,
  resetSessionParseCachePersistenceForTests,
  scheduleSessionParseCachePersist
} from './session-parse-cache-persistence'
import {
  getSessionParseCacheEntry,
  invalidateSessionParseCacheEntry,
  observeSessionParseCacheChanges,
  resetSessionParseCacheForTests,
  seedSessionParseCache,
  sessionParseCacheRevision,
  snapshotSessionParseCacheForPersistence,
  storeSessionParseCacheEntry
} from './session-parse-cache-store'
import {
  SESSION_PARSE_CACHE_SCHEMA_VERSION,
  serializeSessionParseCacheSnapshotPiecesCooperatively
} from './session-parse-cache-snapshot-serialization'

vi.mock('node:fs/promises', { spy: true })
vi.mock('./session-parse-cache-store', { spy: true })
vi.mock('./session-parse-cache-snapshot-serialization', { spy: true })

let root: string
let file: string
let release: (() => void) | null = null

function init(): void {
  initSessionParseCachePersistence({ filePath: file, appVersion: 'test' })
}

function commit(mtimeMs: number): void {
  storeSessionParseCacheEntry('entry', {
    mtimeMs,
    sizeBytes: null,
    platform: process.platform,
    session: null,
    resume: null
  })
}

async function diskEntries() {
  return JSON.parse(await readFile(file, 'utf8')).entries
}

beforeEach(async () => {
  resetSessionParseCacheForTests()
  resetSessionParseCachePersistenceForTests()
  root = await mkdtemp(join(tmpdir(), 'orca-cache-save-lane-'))
  file = join(root, 'cache.json')
  release = null
  vi.clearAllMocks()
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  init()
})

afterEach(async () => {
  release?.()
  await flushSessionParseCachePersist()
  resetSessionParseCachePersistenceForTests()
  resetSessionParseCacheForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

it('coalesces timed mutations behind one writer and keeps its captured snapshot coherent', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises')
  let started = (): void => {}
  const writing = new Promise<void>((resolve) => {
    started = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(fsPromises.writeFile).mockImplementationOnce(async (...args) => {
    await actual.writeFile(...args)
    started()
    await held
  })
  commit(1)
  await vi.advanceTimersByTimeAsync(1_500)
  await writing
  const first = vi.mocked(fsPromises.writeFile).mock.calls[0]
  if (!first) {
    throw new Error('Expected the active snapshot write')
  }
  const captured = await readFile(first[0], 'utf8')
  for (let revision = 2; revision <= 6; revision++) {
    commit(revision)
    init()
    await vi.advanceTimersByTimeAsync(2_000)
  }
  expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)
  expect(snapshotSessionParseCacheForPersistence).toHaveBeenCalledTimes(1)
  expect(serializeSessionParseCacheSnapshotPiecesCooperatively).toHaveBeenCalledTimes(1)
  expect(JSON.parse(captured).entries).toEqual([['entry', expect.objectContaining({ mtimeMs: 1 })]])
  release?.()
  await flushSessionParseCachePersist()
  expect(fsPromises.writeFile).toHaveBeenCalledTimes(2)
  expect(fsPromises.rename).toHaveBeenCalledTimes(2)
  expect(snapshotSessionParseCacheForPersistence).toHaveBeenCalledTimes(2)
  expect(await diskEntries()).toEqual([['entry', expect.objectContaining({ mtimeMs: 6 })]])
})

it('skips a pending timer before snapshot construction when a flush already covered its changes', async () => {
  commit(1)
  commit(2)
  await flushSessionParseCachePersist()
  await vi.advanceTimersByTimeAsync(60_000)
  scheduleSessionParseCachePersist()
  await flushSessionParseCachePersist()
  expect(snapshotSessionParseCacheForPersistence).toHaveBeenCalledTimes(1)
  expect(serializeSessionParseCacheSnapshotPiecesCooperatively).toHaveBeenCalledTimes(1)
  expect(fsPromises.rename).toHaveBeenCalledTimes(1)
})

it.each([
  { operation: 'writeFile', recovery: 'flush' },
  { operation: 'rename', recovery: 'mutation' }
] as const)(
  'bounds $operation failures and recovers through $recovery',
  async ({ operation, recovery }) => {
    commit(0)
    await flushSessionParseCachePersist()
    const previous = await readFile(file, 'utf8')
    vi.clearAllMocks()
    vi.mocked(fsPromises[operation]).mockRejectedValueOnce(new Error('test storage failure'))
    commit(1)
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.waitFor(() => expect(console.debug).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(60_000)
    scheduleSessionParseCachePersist()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(snapshotSessionParseCacheForPersistence).toHaveBeenCalledTimes(1)
    expect(await readFile(file, 'utf8')).toBe(previous)
    if (recovery === 'mutation') {
      commit(2)
    }
    await flushSessionParseCachePersist()
    expect(snapshotSessionParseCacheForPersistence).toHaveBeenCalledTimes(2)
    expect(await diskEntries()).toEqual([
      ['entry', expect.objectContaining({ mtimeMs: recovery === 'mutation' ? 2 : 1 })]
    ])
  }
)

it('does not acknowledge a serializer refusal or spin and permits one explicit retry', async () => {
  commit(0)
  await flushSessionParseCachePersist()
  const previous = await readFile(file, 'utf8')
  vi.clearAllMocks()
  vi.mocked(serializeSessionParseCacheSnapshotPiecesCooperatively).mockResolvedValueOnce(null)
  commit(1)
  await vi.advanceTimersByTimeAsync(1_500)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(serializeSessionParseCacheSnapshotPiecesCooperatively).toHaveBeenCalledTimes(1)
  expect(fsPromises.writeFile).not.toHaveBeenCalled()
  expect(await readFile(file, 'utf8')).toBe(previous)
  await flushSessionParseCachePersist()
  expect(serializeSessionParseCacheSnapshotPiecesCooperatively).toHaveBeenCalledTimes(2)
  expect(fsPromises.rename).toHaveBeenCalledTimes(1)
  expect(await diskEntries()).toEqual([['entry', expect.objectContaining({ mtimeMs: 1 })]])
})

it('retries once when a flush joins an automatic save of the same revision that fails', async () => {
  commit(0)
  await flushSessionParseCachePersist()
  vi.clearAllMocks()
  let started = (): void => {}
  const serializing = new Promise<void>((resolve) => {
    started = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(serializeSessionParseCacheSnapshotPiecesCooperatively).mockImplementationOnce(
    async () => {
      started()
      await held
      return null
    }
  )
  commit(1)
  await vi.advanceTimersByTimeAsync(1_500)
  await serializing
  const flushing = flushSessionParseCachePersist()
  release?.()
  await flushing
  expect(serializeSessionParseCacheSnapshotPiecesCooperatively).toHaveBeenCalledTimes(2)
  expect(fsPromises.rename).toHaveBeenCalledTimes(1)
  expect(await diskEntries()).toEqual([['entry', expect.objectContaining({ mtimeMs: 1 })]])
  await vi.advanceTimersByTimeAsync(60_000)
  expect(serializeSessionParseCacheSnapshotPiecesCooperatively).toHaveBeenCalledTimes(2)
})

it('reconciles live changes across initialization and loading while seed-only work stays quiet', async () => {
  seedSessionParseCache([
    ['seeded', { mtimeMs: 0, sizeBytes: null, platform: process.platform, session: null }]
  ])
  await flushSessionParseCachePersist()
  expect(snapshotSessionParseCacheForPersistence).not.toHaveBeenCalled()
  resetSessionParseCachePersistenceForTests()
  commit(1)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(fsPromises.writeFile).not.toHaveBeenCalled()
  init()
  await ensureSessionParseCacheLoaded()
  await flushSessionParseCachePersist()
  expect(await diskEntries()).toEqual(
    expect.arrayContaining([['entry', expect.objectContaining({ mtimeMs: 1 })]])
  )
  resetSessionParseCachePersistenceForTests()
  commit(2)
  vi.clearAllMocks()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(fsPromises.writeFile).not.toHaveBeenCalled()
  init()
  await ensureSessionParseCacheLoaded()
  await flushSessionParseCachePersist()
  expect(fsPromises.rename).toHaveBeenCalledTimes(1)
  expect(await diskEntries()).toEqual(
    expect.arrayContaining([['entry', expect.objectContaining({ mtimeMs: 2 })]])
  )
})

it('ignores recency and absent invalidation but checkpoints actual removal', async () => {
  commit(1)
  await flushSessionParseCachePersist()
  vi.clearAllMocks()
  const revision = sessionParseCacheRevision()
  const entry = getSessionParseCacheEntry('entry')
  if (!entry) {
    throw new Error('Expected a reusable entry')
  }
  storeSessionParseCacheEntry('entry', { ...entry, foldSession: null })
  invalidateSessionParseCacheEntry('missing')
  await flushSessionParseCachePersist()
  expect(sessionParseCacheRevision()).toBe(revision)
  expect(snapshotSessionParseCacheForPersistence).not.toHaveBeenCalled()
  invalidateSessionParseCacheEntry('entry')
  expect(sessionParseCacheRevision()).toBe(revision + 1)
  await flushSessionParseCachePersist()
  expect(fsPromises.rename).toHaveBeenCalledTimes(1)
  expect(await diskEntries()).toEqual([])
})

it('keeps cache mutation usable after notification failure and reconciles it on explicit flush', async () => {
  observeSessionParseCacheChanges(() => {
    throw new Error('test notification failure')
  })
  expect(() => commit(1)).not.toThrow()
  expect(getSessionParseCacheEntry('entry')?.mtimeMs).toBe(1)
  await flushSessionParseCachePersist()
  expect(fsPromises.rename).toHaveBeenCalledTimes(1)
})

it('waits for hydration before capturing a replacement and preserves live updates made during loading', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises')
  resetSessionParseCachePersistenceForTests()
  await actual.writeFile(
    file,
    JSON.stringify({
      schemaVersion: SESSION_PARSE_CACHE_SCHEMA_VERSION,
      appVersion: 'test',
      entries: ['older', 'entry'].map((path) => [
        path,
        { mtimeMs: 0, sizeBytes: null, platform: process.platform, session: null }
      ])
    })
  )
  commit(2)
  let started = (): void => {}
  const opening = new Promise<void>((resolve) => {
    started = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(fsPromises.open).mockImplementationOnce(async (...args) => {
    started()
    await held
    return actual.open(...args)
  })
  init()
  const loading = ensureSessionParseCacheLoaded()
  try {
    await opening
    commit(3)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(snapshotSessionParseCacheForPersistence).not.toHaveBeenCalled()
    expect(fsPromises.writeFile).not.toHaveBeenCalled()
  } finally {
    release?.()
    await loading
  }
  await flushSessionParseCachePersist()
  expect(await diskEntries()).toEqual([
    ['entry', expect.objectContaining({ mtimeMs: 3 })],
    ['older', expect.objectContaining({ mtimeMs: 0 })]
  ])
  await vi.advanceTimersByTimeAsync(60_000)
  await flushSessionParseCachePersist()
  expect(snapshotSessionParseCacheForPersistence).toHaveBeenCalledTimes(1)
  expect(fsPromises.rename).toHaveBeenCalledTimes(1)
})

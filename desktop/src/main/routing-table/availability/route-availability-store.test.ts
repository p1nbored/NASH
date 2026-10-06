import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTING_TABLE_DIR_NAME } from '../routing-table-file-store'
import { FIXTURE_USER_DATA } from '../routing-table-test-context.test-fixture'
import {
  createMemoryAvailabilityFs,
  type MemoryAvailabilityFs
} from './route-availability-fs.test-fixture'
import { NOW_MS, detectionOf, listingOf, CODEX_MODELS } from './route-availability.test-fixture'
import {
  MAX_CLEARED_ROUTES,
  MAX_LATCHES,
  createRouteAvailabilityStore,
  type RouteLatch
} from './route-availability-store'

const FILE = join(FIXTURE_USER_DATA, ROUTING_TABLE_DIR_NAME, 'availability.json')
const STAMP = '2026-10-05T12-00-00-000Z'

function createStore(fs: MemoryAvailabilityFs = createMemoryAvailabilityFs(() => NOW_MS)) {
  const store = createRouteAvailabilityStore({
    paths: { getUserDataPath: () => FIXTURE_USER_DATA },
    fs,
    now: () => NOW_MS
  })
  return { store, fs }
}

const latch = (routeKey: string, kind: RouteLatch['kind'], latchedAtMs = NOW_MS): RouteLatch => ({
  routeKey,
  kind,
  latchedAtMs
})

describe('observation caches', () => {
  it('holds the latest listing per provider and nothing for the others', () => {
    const { store } = createStore()
    expect(store.getListing('codex')).toBeNull()
    store.putListing('codex', listingOf(CODEX_MODELS))
    expect(store.getListing('codex')).toEqual(listingOf(CODEX_MODELS))
    expect(store.getListing('claude')).toBeNull()
  })

  it('replaces a listing, including a good one by a failure, because the newest word wins', () => {
    const { store } = createStore()
    store.putListing('codex', listingOf(CODEX_MODELS))
    store.putListing('codex', { ok: false, observedAtMs: NOW_MS + 5 })
    expect(store.getListing('codex')).toEqual({ ok: false, observedAtMs: NOW_MS + 5 })
  })

  it('holds the latest detection with the time it was read', () => {
    const { store } = createStore()
    expect(store.getDetection()).toBeNull()
    store.putDetection(detectionOf(['claude']), NOW_MS)
    expect(store.getDetection()).toEqual({ reading: detectionOf(['claude']), observedAtMs: NOW_MS })
  })

  it('forgets every cached observation but keeps the latches', () => {
    const { store } = createStore()
    store.putListing('codex', listingOf(CODEX_MODELS))
    store.putDetection(detectionOf(), NOW_MS)
    store.addLatch(latch('k', 'auth'))
    store.clearObservations()
    expect(store.getListing('codex')).toBeNull()
    expect(store.getDetection()).toBeNull()
    expect(store.latchesFor('k')).toHaveLength(1)
  })

  it('writes nothing to disk for cached observations', () => {
    const { store, fs } = createStore()
    store.putListing('codex', listingOf(CODEX_MODELS))
    store.putDetection(detectionOf(), NOW_MS)
    expect(fs.writeLog).toEqual([])
  })
})

describe('latches', () => {
  it('records a latch per route and kind, and lists them for the route only', () => {
    const { store } = createStore()
    store.addLatch(latch('codex_cli|gpt-6.1-sol|max', 'auth'))
    store.addLatch(latch('codex_cli|gpt-6.1-sol|max', 'quota', NOW_MS + 1))
    store.addLatch(latch('codex_cli|gpt-6-astra|max', 'auth'))
    expect(
      store
        .latchesFor('codex_cli|gpt-6.1-sol|max')
        .map((entry) => entry.kind)
        .sort()
    ).toEqual(['auth', 'quota'])
    expect(store.latchesFor('claude_subagent|claude-opus-5-5|max')).toEqual([])
  })

  it('keeps one latch per route and kind, at the newest time', () => {
    const { store } = createStore()
    store.addLatch(latch('k', 'auth', NOW_MS))
    store.addLatch(latch('k', 'auth', NOW_MS + 10))
    expect(store.latchesFor('k')).toEqual([latch('k', 'auth', NOW_MS + 10)])
  })

  it('clears one kind without touching the other', () => {
    const { store } = createStore()
    store.addLatch(latch('k', 'auth'))
    store.addLatch(latch('k', 'quota'))
    store.clearLatch('k', 'auth')
    expect(store.latchesFor('k')).toEqual([latch('k', 'quota')])
    store.clearLatch('k', 'auth')
    expect(store.latchesFor('k')).toEqual([latch('k', 'quota')])
  })

  it('survives a restart: a new store over the same files reads the latches back', () => {
    const first = createStore()
    first.store.addLatch(latch('k', 'auth', NOW_MS))
    const second = createStore(first.fs)
    expect(second.store.latchesFor('k')).toEqual([latch('k', 'auth', NOW_MS)])
    expect(first.fs.writeLog).toEqual([FILE])
  })

  it('persists a clear as well', () => {
    const first = createStore()
    first.store.addLatch(latch('k', 'auth'))
    first.store.clearLatch('k', 'auth')
    expect(createStore(first.fs).store.latchesFor('k')).toEqual([])
  })

  it('keeps no route name, model or account in the file beyond the route key and kind', () => {
    const first = createStore()
    first.store.addLatch(latch('codex_cli|gpt-6.1-sol|max', 'auth', NOW_MS))
    expect(JSON.parse(first.fs.files.get(FILE) ?? '{}')).toEqual({
      schema_version: 1,
      latches: [{ route_key: 'codex_cli|gpt-6.1-sol|max', kind: 'auth', latched_at_ms: NOW_MS }]
    })
  })

  it('evicts the oldest latch past the cap rather than refusing a new failure', () => {
    const { store } = createStore()
    for (let index = 0; index < MAX_LATCHES + 1; index += 1) {
      store.addLatch(latch(`route-${index}`, 'auth', NOW_MS + index))
    }
    expect(store.latchesFor('route-0')).toEqual([])
    expect(store.latchesFor(`route-${MAX_LATCHES}`)).toHaveLength(1)
  })

  it('keeps the latch in memory when the file cannot be written, and says so', () => {
    const { store, fs } = createStore()
    fs.failNextWriteMatching(/availability\.json$/)
    store.addLatch(latch('k', 'auth'))
    expect(store.latchesFor('k')).toHaveLength(1)
    expect(store.persistenceFailed()).toBe(true)
    store.addLatch(latch('k2', 'auth'))
    expect(store.persistenceFailed()).toBe(false)
  })

  it('starts empty and writes nothing when there is no file yet', () => {
    const { store, fs } = createStore()
    expect(store.latchesFor('k')).toEqual([])
    expect(fs.writeLog).toEqual([])
    expect([...fs.files.keys()]).toEqual([])
  })
})

describe('a damaged availability file fails closed', () => {
  const DAMAGED_AT = NOW_MS - 600_000
  const DAMAGED_TEXT = '{nope'
  const quarantined = (fs: MemoryAvailabilityFs) =>
    [...fs.files.keys()].filter((path) => path.startsWith(`${FILE}.damaged-`))
  const both = (routeKey: string, sinceMs = DAMAGED_AT): RouteLatch[] => [
    { routeKey, kind: 'auth', latchedAtMs: sinceMs, source: 'availability_file_damaged' },
    { routeKey, kind: 'quota', latchedAtMs: sinceMs, source: 'availability_file_damaged' }
  ]

  function damaged(text = DAMAGED_TEXT, mtimeMs = DAMAGED_AT) {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(FILE, text, mtimeMs)
    return createStore(fs)
  }

  it.each([
    ['not json', '{nope'],
    ['an unknown schema version', JSON.stringify({ schema_version: 9, latches: [] })],
    [
      'a latch with an unknown kind',
      JSON.stringify({
        schema_version: 1,
        latches: [{ route_key: 'k', kind: 'x', latched_at_ms: 1 }]
      })
    ],
    ['an extra key', JSON.stringify({ schema_version: 1, latches: [], extra: true })],
    ['too large', JSON.stringify({ schema_version: 1, latches: [], pad: 'x'.repeat(400_000) })]
  ])('latches every route since the file was last written (%s)', (_name, text) => {
    const { store, fs } = damaged(text)
    expect(store.latchesFor('any-route')).toEqual(both('any-route'))
    expect(store.latchesFor('another-route')).toEqual(both('another-route'))
    expect(quarantined(fs)).toHaveLength(1)
  })

  it('treats an unreadable file the same way', () => {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(FILE, '{"schema_version":1,"latches":[]}', DAMAGED_AT)
    fs.unreadable.add(FILE)
    const { store } = createStore(fs)
    expect(store.latchesFor('k')).toEqual(both('k'))
    expect(quarantined(fs)).toHaveLength(1)
  })

  it('renames the file with a timestamp suffix and keeps its bytes, never deleting it', () => {
    const { fs } = damaged()
    expect(quarantined(fs)).toEqual([`${FILE}.damaged-${STAMP}`])
    expect(fs.files.get(`${FILE}.damaged-${STAMP}`)).toBe(DAMAGED_TEXT)
  })

  it('never overwrites an earlier quarantined file', () => {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(`${FILE}.damaged-${STAMP}`, 'older damage', DAMAGED_AT - 1)
    fs.seed(FILE, DAMAGED_TEXT, DAMAGED_AT)
    createStore(fs)
    expect(fs.files.get(`${FILE}.damaged-${STAMP}`)).toBe('older damage')
    expect(fs.files.get(`${FILE}.damaged-${STAMP}-1`)).toBe(DAMAGED_TEXT)
  })

  it('writes a fresh file that records the damage, so the next start stays closed', () => {
    const { store, fs } = damaged()
    expect(JSON.parse(fs.files.get(FILE) ?? '{}')).toEqual({
      schema_version: 1,
      latches: [],
      damaged: { since_ms: DAMAGED_AT, cleared: [] }
    })
    expect(createStore(fs).store.latchesFor('k')).toEqual(both('k'))
    expect(store.persistenceFailed()).toBe(false)
  })

  it('uses the current time when the modification time cannot be read', () => {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(FILE, DAMAGED_TEXT, DAMAGED_AT)
    fs.failures.modifiedAt = true
    const { store } = createStore(fs)
    expect(store.latchesFor('k')).toEqual(both('k', NOW_MS))
  })

  it('clears one route and kind at a time, and remembers that across a restart', () => {
    const { store, fs } = damaged()
    store.clearLatch('k', 'auth')
    expect(store.latchesFor('k')).toEqual([both('k')[1]])
    expect(store.latchesFor('other')).toEqual(both('other'))
    expect(createStore(fs).store.latchesFor('k')).toEqual([both('k')[1]])
    store.clearLatch('k', 'quota')
    expect(store.latchesFor('k')).toEqual([])
    expect(createStore(fs).store.latchesFor('k')).toEqual([])
  })

  it('lets a later executor failure replace the blanket latch of its kind, and one clear lifts both', () => {
    const { store } = damaged()
    store.addLatch(latch('k', 'auth', NOW_MS))
    expect(store.latchesFor('k')).toEqual([latch('k', 'auth', NOW_MS), both('k')[1]])
    store.clearLatch('k', 'auth')
    expect(store.latchesFor('k')).toEqual([both('k')[1]])
  })

  it('latches a route that was cleared once the cleared list is full, rather than dropping the damage', () => {
    const { store } = damaged()
    for (let index = 0; index <= MAX_CLEARED_ROUTES; index += 1) {
      store.clearLatch(`route-${index}`, 'auth')
    }
    expect(store.latchesFor('route-0').map((entry) => entry.kind)).toEqual(['auth', 'quota'])
    expect(store.latchesFor(`route-${MAX_CLEARED_ROUTES}`).map((entry) => entry.kind)).toEqual([
      'quota'
    ])
  })

  it('keeps the damaged file in place and blocks writes when it cannot be renamed', () => {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(FILE, DAMAGED_TEXT, DAMAGED_AT)
    fs.failures.rename = true
    const { store } = createStore(fs)
    expect(store.latchesFor('k')).toEqual(both('k'))
    expect(store.persistenceFailed()).toBe(true)
    store.addLatch(latch('k2', 'auth'))
    store.clearLatch('k', 'auth')
    expect(fs.files.get(FILE)).toBe(DAMAGED_TEXT)
    expect(fs.writeLog).toEqual([])
  })

  it('stays closed on the next start when the replacement file could not be written', () => {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(FILE, DAMAGED_TEXT, DAMAGED_AT)
    fs.failNextWriteMatching(/availability\.json$/)
    const first = createStore(fs)
    expect(first.store.latchesFor('k')).toEqual(both('k'))
    expect(first.store.persistenceFailed()).toBe(true)
    expect(quarantined(fs)).toHaveLength(1)
    expect(fs.files.has(FILE)).toBe(false)
    expect(createStore(fs).store.latchesFor('k')).toEqual(both('k'))
    expect(JSON.parse(fs.files.get(FILE) ?? '{}').damaged.since_ms).toBe(DAMAGED_AT)
  })

  it('does not treat a quarantined copy beside a good file as damage', () => {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(`${FILE}.damaged-${STAMP}`, 'older damage', DAMAGED_AT)
    fs.seed(FILE, JSON.stringify({ schema_version: 1, latches: [] }), NOW_MS)
    expect(createStore(fs).store.latchesFor('k')).toEqual([])
  })
})

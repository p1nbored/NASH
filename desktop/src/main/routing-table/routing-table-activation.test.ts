import { describe, expect, it } from 'vitest'
import { RoutingTableSchema } from '../../shared/routing-table/routing-table-schema'
import {
  activateRoutingTable,
  ensureActiveRoutingTable,
  listRoutingTableVersions,
  resolveActiveRoutingTable,
  revertRoutingTable
} from './routing-table-activation'
import {
  getBundledRoutingTable,
  routingTableContentSha256,
  routingTableSha256
} from './routing-table-bundle'
import {
  INDEX_FILE_PATH,
  createTestRoutingTableEnvironment,
  parsedTestTable,
  versionFilePath
} from './routing-table-test-context.test-fixture'

/** Installs the bundled table as version 1 and returns the environment. */
function installed() {
  const env = createTestRoutingTableEnvironment()
  const first = ensureActiveRoutingTable(env.ctx)
  expect(first.ok).toBe(true)
  env.fs.writeLog.length = 0
  return env
}

function nextTable(version: number, overrides: Record<string, unknown> = {}) {
  const active = getBundledRoutingTable()
  return RoutingTableSchema.parse({
    ...active,
    table_version: version,
    source: 'user',
    based_on: version > 1 ? { table_version: version - 1, sha256: 'a'.repeat(64) } : null,
    created_at: '2026-10-04T13:00:00Z',
    coordinator: { model: 'claude-opus-5-5', reasoning_level: 'high' },
    ...overrides
  })
}

describe('first start', () => {
  it('reports not installed before anything is written, and writes nothing', () => {
    const env = createTestRoutingTableEnvironment()
    expect(resolveActiveRoutingTable(env.ctx)).toEqual({
      ok: false,
      reason: 'routing_table_not_installed'
    })
    expect(env.fs.writeLog).toEqual([])
  })

  it('installs the bundled table as version 1: the version file first, then the index', () => {
    const env = createTestRoutingTableEnvironment()
    const active = ensureActiveRoutingTable(env.ctx)
    expect(active.ok && active.version).toBe(1)
    expect(active.ok && active.source).toBe('bundled')
    expect(env.fs.writeLog).toEqual([versionFilePath(1), INDEX_FILE_PATH])
    const index = JSON.parse(env.fs.files.get(INDEX_FILE_PATH) ?? '{}')
    expect(index.active_version).toBe(1)
    expect(index.bundled_version_seen).toBe(getBundledRoutingTable().table_version)
    expect(index.versions[0].sha256).toBe(active.ok ? active.sha256 : '')
  })

  it('numbers its own versions from 1 even when the bundled table carries a later number', () => {
    const bundled = parsedTestTable({ table_version: 5 })
    const env = createTestRoutingTableEnvironment({ bundled })
    const active = ensureActiveRoutingTable(env.ctx)
    expect(active.ok && active.version).toBe(1)
    expect(active.ok && active.table.table_version).toBe(1)
    expect(JSON.parse(env.fs.files.get(INDEX_FILE_PATH) ?? '{}').bundled_version_seen).toBe(5)
  })

  it('is idempotent: a second start reads and writes nothing new', () => {
    const env = installed()
    const again = ensureActiveRoutingTable(env.ctx)
    expect(again.ok && again.version).toBe(1)
    expect(env.fs.writeLog).toEqual([])
  })

  it('refuses to install a bundled table whose taxonomy differs from the classifier', () => {
    const env = createTestRoutingTableEnvironment({ expectedTaxonomyVersion: 3 })
    expect(ensureActiveRoutingTable(env.ctx)).toMatchObject({
      ok: false,
      reason: 'routing_table_taxonomy_mismatch'
    })
    expect(env.fs.writeLog).toEqual([])
  })
})

describe('integrity: a damaged store blocks routing and never falls back to the bundled table', () => {
  function expectBlocked(env: ReturnType<typeof installed>, detail: string): void {
    for (const result of [resolveActiveRoutingTable(env.ctx), ensureActiveRoutingTable(env.ctx)]) {
      expect(result).toEqual({
        ok: false,
        reason: 'routing_table_integrity_failed',
        detail
      })
    }
    expect(env.fs.writeLog).toEqual([])
  }

  it('detects an edited version file by its hash', () => {
    const env = installed()
    const text = env.fs.files.get(versionFilePath(1)) ?? ''
    env.fs.files.set(versionFilePath(1), text.replace('"gpt-6-astra"', '"gpt-6.1-sol"'))
    expectBlocked(env, 'version_hash_mismatch')
  })

  it('detects a deleted version file', () => {
    const env = installed()
    env.fs.files.delete(versionFilePath(1))
    expectBlocked(env, 'version_missing')
  })

  it('detects a version file that no longer parses', () => {
    const env = installed()
    env.fs.files.set(versionFilePath(1), '{"schema_version":1}')
    expectBlocked(env, 'version_invalid')
  })

  it('detects an index that does not parse', () => {
    const env = installed()
    env.fs.files.set(INDEX_FILE_PATH, '{broken')
    expectBlocked(env, 'index_invalid')
  })

  it.each([
    ['index_unreadable', INDEX_FILE_PATH],
    ['version_unreadable', versionFilePath(1)]
  ])(
    'reports %s when the file cannot be read for a reason other than not found',
    (detail, blocked) => {
      const env = installed()
      const readFile = env.fs.readFile
      env.fs.readFile = (path) => {
        if (path === blocked) {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
        }
        return readFile(path)
      }
      expectBlocked(env, detail)
    }
  )

  it('detects a deleted index next to existing versions instead of installing over them', () => {
    const env = installed()
    env.fs.files.delete(INDEX_FILE_PATH)
    expectBlocked(env, 'index_missing')
  })

  it('detects an index hash that was edited without the version', () => {
    const env = installed()
    const index = JSON.parse(env.fs.files.get(INDEX_FILE_PATH) ?? '{}')
    index.versions[0].sha256 = 'f'.repeat(64)
    env.fs.files.set(INDEX_FILE_PATH, JSON.stringify(index))
    expectBlocked(env, 'version_hash_mismatch')
  })

  it('does not let a damaged historical version block the active one', () => {
    const env = installed()
    expect(activateRoutingTable(env.ctx, { table: nextTable(2), proposalId: null }).ok).toBe(true)
    env.fs.files.set(versionFilePath(1), 'corrupt')
    const active = resolveActiveRoutingTable(env.ctx)
    expect(active.ok && active.version).toBe(2)
  })

  it('returns no table at all on failure', () => {
    const env = installed()
    env.fs.files.delete(versionFilePath(1))
    expect(resolveActiveRoutingTable(env.ctx)).not.toHaveProperty('table')
  })
})

describe('taxonomy', () => {
  it('stops routing while the active table taxonomy differs from the classifier', () => {
    const first = installed()
    const classifierMovedOn = createTestRoutingTableEnvironment({
      fs: first.fs,
      expectedTaxonomyVersion: 3
    })
    expect(resolveActiveRoutingTable(classifierMovedOn.ctx)).toEqual({
      ok: false,
      reason: 'routing_table_taxonomy_mismatch',
      tableTaxonomyVersion: 2,
      expectedTaxonomyVersion: 3
    })
  })

  it('refuses to activate a table of another taxonomy', () => {
    const env = installed()
    const result = activateRoutingTable(env.ctx, {
      table: nextTable(2, { taxonomy_version: 1 }),
      proposalId: null
    })
    expect(result).toMatchObject({ ok: false, reason: 'routing_table_taxonomy_mismatch' })
    expect(env.fs.writeLog).toEqual([])
  })
})

describe('activating a version', () => {
  it('writes the version file first, then the index, and records the hash', () => {
    const env = installed()
    const table = nextTable(2)
    const result = activateRoutingTable(env.ctx, { table, proposalId: 'proposal-0001' })
    expect(result).toEqual({ ok: true, version: 2, sha256: routingTableSha256(table) })
    expect(env.fs.writeLog).toEqual([versionFilePath(2), INDEX_FILE_PATH])
    const index = JSON.parse(env.fs.files.get(INDEX_FILE_PATH) ?? '{}')
    expect(index.active_version).toBe(2)
    expect(index.versions.map((entry: { table_version: number }) => entry.table_version)).toEqual([
      1, 2
    ])
    expect(index.versions[1]).toMatchObject({ source: 'user', proposal_id: 'proposal-0001' })
    const active = resolveActiveRoutingTable(env.ctx)
    expect(active.ok && active.table.coordinator.reasoning_level).toBe('high')
  })

  it('keeps the earlier version files untouched', () => {
    const env = installed()
    const before = env.fs.files.get(versionFilePath(1))
    activateRoutingTable(env.ctx, { table: nextTable(2), proposalId: null })
    expect(env.fs.files.get(versionFilePath(1))).toBe(before)
  })

  it('refuses a version number that is not the next one', () => {
    const env = installed()
    for (const version of [1, 3]) {
      expect(
        activateRoutingTable(env.ctx, { table: nextTable(version), proposalId: null })
      ).toMatchObject({
        ok: false,
        reason: 'version_conflict'
      })
    }
    expect(env.fs.writeLog).toEqual([])
  })

  it('refuses a table that does not pass the schema, with nothing written', () => {
    const env = installed()
    const broken = {
      ...nextTable(2),
      coordinator: { model: 'gemini-4', reasoning_level: 'max' as const }
    }
    expect(activateRoutingTable(env.ctx, { table: broken, proposalId: null })).toMatchObject({
      ok: false,
      reason: 'invalid_table'
    })
    expect(env.fs.writeLog).toEqual([])
  })

  it('refuses to activate over a damaged store', () => {
    const env = installed()
    env.fs.files.delete(versionFilePath(1))
    expect(activateRoutingTable(env.ctx, { table: nextTable(2), proposalId: null })).toMatchObject({
      ok: false,
      reason: 'routing_table_integrity_failed'
    })
    expect(env.fs.writeLog).toEqual([])
  })

  it('stays on the old version when the index write fails, and a retry succeeds over the orphan file', () => {
    const env = installed()
    env.fs.failNextWriteMatching(/index\.json$/)
    expect(() => activateRoutingTable(env.ctx, { table: nextTable(2), proposalId: null })).toThrow(
      /simulated write failure/
    )
    const stillOld = resolveActiveRoutingTable(env.ctx)
    expect(stillOld.ok && stillOld.version).toBe(1)
    expect(env.fs.files.has(versionFilePath(2))).toBe(true)
    const retry = activateRoutingTable(env.ctx, { table: nextTable(2), proposalId: null })
    expect(retry.ok).toBe(true)
    const now = resolveActiveRoutingTable(env.ctx)
    expect(now.ok && now.version).toBe(2)
  })

  it('lists the versions with their hashes', () => {
    const env = installed()
    activateRoutingTable(env.ctx, { table: nextTable(2), proposalId: null })
    const listed = listRoutingTableVersions(env.ctx)
    expect(listed.ok && listed.versions.map((entry) => entry.table_version)).toEqual([1, 2])
    expect(listed.ok && listed.activeVersion).toBe(2)
  })
})

describe('reverting', () => {
  function withTwoVersions() {
    const env = installed()
    activateRoutingTable(env.ctx, { table: nextTable(2), proposalId: null })
    env.fs.writeLog.length = 0
    return env
  }

  it('re-activates old content under a new version number', () => {
    const env = withTwoVersions()
    const result = revertRoutingTable(env.ctx, { version: 1, caller: 'desktop_user' })
    expect(result).toMatchObject({ ok: true, version: 3 })
    const active = resolveActiveRoutingTable(env.ctx)
    expect(active.ok && active.version).toBe(3)
    expect(active.ok && active.source).toBe('user')
    expect(active.ok && active.table.coordinator.reasoning_level).toBe('max')
    expect(active.ok && routingTableContentSha256(active.table)).toBe(
      routingTableContentSha256(getBundledRoutingTable())
    )
    expect(active.ok && active.table.based_on?.table_version).toBe(1)
    expect(env.fs.writeLog).toEqual([versionFilePath(3), INDEX_FILE_PATH])
  })

  it('is for the desktop user only', () => {
    const env = withTwoVersions()
    for (const caller of ['agent', 'app', 'dot', undefined]) {
      expect(revertRoutingTable(env.ctx, { version: 1, caller })).toEqual({
        ok: false,
        reason: 'forbidden_caller'
      })
    }
    expect(env.fs.writeLog).toEqual([])
  })

  it('refuses an unknown version and a revert to the content that is already active', () => {
    const env = withTwoVersions()
    expect(revertRoutingTable(env.ctx, { version: 9, caller: 'desktop_user' })).toMatchObject({
      ok: false,
      reason: 'version_unknown'
    })
    expect(revertRoutingTable(env.ctx, { version: 2, caller: 'desktop_user' })).toMatchObject({
      ok: false,
      reason: 'no_change'
    })
    expect(env.fs.writeLog).toEqual([])
  })

  it('refuses a damaged target version', () => {
    const env = withTwoVersions()
    env.fs.files.set(versionFilePath(1), 'corrupt')
    expect(revertRoutingTable(env.ctx, { version: 1, caller: 'desktop_user' })).toMatchObject({
      ok: false,
      reason: 'routing_table_integrity_failed'
    })
  })

  it('recovers routing when the active version is damaged but an earlier one is intact', () => {
    const env = withTwoVersions()
    env.fs.files.set(versionFilePath(2), 'corrupt')
    expect(resolveActiveRoutingTable(env.ctx).ok).toBe(false)
    expect(revertRoutingTable(env.ctx, { version: 1, caller: 'desktop_user' })).toMatchObject({
      ok: true,
      version: 3
    })
    expect(resolveActiveRoutingTable(env.ctx).ok).toBe(true)
  })

  it('refuses a target of another taxonomy', () => {
    const first = withTwoVersions()
    const classifierMovedOn = createTestRoutingTableEnvironment({
      fs: first.fs,
      expectedTaxonomyVersion: 3
    })
    expect(
      revertRoutingTable(classifierMovedOn.ctx, { version: 1, caller: 'desktop_user' })
    ).toMatchObject({
      ok: false,
      reason: 'routing_table_taxonomy_mismatch'
    })
  })
})

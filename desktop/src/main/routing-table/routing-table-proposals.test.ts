import { describe, expect, it } from 'vitest'
import {
  RoutingTableSchema,
  type RoutingTable
} from '../../shared/routing-table/routing-table-schema'
import { ensureActiveRoutingTable, resolveActiveRoutingTable } from './routing-table-activation'
import { getBundledRoutingTable } from './routing-table-bundle'
import {
  acceptRoutingTableProposal,
  listRoutingTableProposals,
  proposeBundledUpdate,
  rejectRoutingTableProposal,
  submitRoutingTableProposal
} from './routing-table-proposals'
import {
  FIXTURE_TABLE_DIR,
  INDEX_FILE_PATH,
  createTestRoutingTableEnvironment,
  versionFilePath
} from './routing-table-test-context.test-fixture'
import { join } from 'node:path'

function proposalPath(id: string): string {
  return join(FIXTURE_TABLE_DIR, 'proposals', `${id}.json`)
}

function installed() {
  const env = createTestRoutingTableEnvironment()
  const active = ensureActiveRoutingTable(env.ctx)
  if (!active.ok) {
    throw new Error('fixture install failed')
  }
  env.fs.writeLog.length = 0
  return { ...env, base: { table_version: active.version, sha256: active.sha256 } }
}

type Installed = ReturnType<typeof installed>

const ASTRA_ROW = {
  task_type: 'software_engineering',
  execution_target: 'codex_cli',
  model: 'gpt-6-astra',
  reasoning_level: 'max'
}

function submission(env: Installed, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    proposer: 'agent',
    base: env.base,
    changes: [ASTRA_ROW],
    rationale: 'A newer model leads the engineering benchmarks.',
    evidence: [{ name: 'Artificial Analysis' }],
    ...overrides
  }
}

function submitOk(
  env: Installed,
  overrides: Record<string, unknown> = {},
  caller = 'agent'
): string {
  const result = submitRoutingTableProposal(env.ctx, submission(env, overrides), caller)
  if (!result.ok) {
    throw new Error(`submit failed: ${result.reason}`)
  }
  return result.proposalId
}

describe('submitting a proposal', () => {
  it('stores it as pending with the content hash of the table it would produce', () => {
    const env = installed()
    const result = submitRoutingTableProposal(env.ctx, submission(env), 'agent')
    expect(result).toMatchObject({ ok: true, proposalId: 'proposal-0001' })
    expect(env.fs.writeLog).toEqual([proposalPath('proposal-0001')])
    const listed = listRoutingTableProposals(env.ctx)
    expect(listed.entries).toHaveLength(1)
    expect(listed.entries[0]).toMatchObject({ decision: null, stale: false })
    expect(listed.entries[0]?.proposal.proposer).toBe('agent')
    expect(env.fs.files.has(INDEX_FILE_PATH)).toBe(true)
  })

  it('does not change the active table or write a version', () => {
    const env = installed()
    submitOk(env)
    const active = resolveActiveRoutingTable(env.ctx)
    expect(active.ok && active.version).toBe(1)
    expect(env.fs.files.has(versionFilePath(2))).toBe(false)
  })

  it('refuses an invalid body, a malformed id and a non-English rationale', () => {
    const env = installed()
    const bad = [
      submission(env, { changes: [{ ...ASTRA_ROW, model: 'invalid model' }] }),
      submission(env, { changes: [{ ...ASTRA_ROW, model: 'opus' }] }),
      submission(env, { rationale: '更新模型' }),
      submission(env, { changes: [{ ...ASTRA_ROW, notes: '工程' }] }),
      { ...submission(env), unexpected: true },
      null,
      'proposal'
    ]
    for (const input of bad) {
      expect(submitRoutingTableProposal(env.ctx, input, 'agent')).toMatchObject({
        ok: false,
        reason: 'invalid_proposal'
      })
    }
    expect(env.fs.writeLog).toEqual([])
  })

  it('refuses a base that is not a known accepted version with that hash', () => {
    const env = installed()
    for (const base of [
      { table_version: 9, sha256: env.base.sha256 },
      { table_version: 1, sha256: 'e'.repeat(64) }
    ]) {
      expect(submitRoutingTableProposal(env.ctx, submission(env, { base }), 'agent')).toMatchObject(
        {
          ok: false,
          reason: 'base_not_active'
        }
      )
    }
  })

  it('stops an agent from posing as the app or the user', () => {
    const env = installed()
    for (const proposer of ['bundled_update', 'benchmark_review', 'user_import']) {
      expect(
        submitRoutingTableProposal(env.ctx, submission(env, { proposer }), 'agent')
      ).toMatchObject({
        ok: false,
        reason: 'forbidden_proposer'
      })
    }
    expect(
      submitRoutingTableProposal(env.ctx, submission(env, { proposer: 'agent' }), 'dot')
    ).toMatchObject({
      ok: false,
      reason: 'forbidden_caller'
    })
    expect(env.fs.writeLog).toEqual([])
  })

  it('lets the app and the desktop user submit their own kinds', () => {
    const env = installed()
    expect(
      submitRoutingTableProposal(env.ctx, submission(env, { proposer: 'benchmark_review' }), 'app')
        .ok
    ).toBe(true)
    expect(
      submitRoutingTableProposal(
        env.ctx,
        submission(env, {
          proposer: 'user_import',
          changes: [{ ...ASTRA_ROW, reasoning_level: 'high' }]
        }),
        'desktop_user'
      ).ok
    ).toBe(true)
    expect(
      submitRoutingTableProposal(env.ctx, submission(env, { proposer: 'user_import' }), 'app')
    ).toMatchObject({ ok: false, reason: 'forbidden_proposer' })
  })

  it('refuses a proposal that would leave the table unchanged', () => {
    const env = installed()
    const unchanged = getBundledRoutingTable().routes[2]
    const result = submitRoutingTableProposal(
      env.ctx,
      submission(env, { changes: [unchanged] }),
      'agent'
    )
    expect(result).toMatchObject({
      ok: false,
      reason: 'duplicate_content',
      existingProposalId: null
    })
  })

  it('de-duplicates identical content against pending proposals', () => {
    const env = installed()
    const first = submitOk(env)
    const second = submitRoutingTableProposal(
      env.ctx,
      submission(env, { rationale: 'Same change, different words.', evidence: [] }),
      'agent'
    )
    expect(second).toMatchObject({
      ok: false,
      reason: 'duplicate_content',
      existingProposalId: first
    })
  })

  it('de-duplicates content the user rejected before', () => {
    const env = installed()
    const first = submitOk(env)
    expect(
      rejectRoutingTableProposal(env.ctx, { proposalId: first, caller: 'desktop_user' }).ok
    ).toBe(true)
    expect(submitRoutingTableProposal(env.ctx, submission(env), 'agent')).toMatchObject({
      ok: false,
      reason: 'duplicate_content',
      existingProposalId: first
    })
  })

  it('accepts a rebased proposal after the first one was superseded', () => {
    const env = installed()
    const first = submitOk(env)
    const other = submitOk(env, { changes: [{ ...ASTRA_ROW, task_type: 'high_quality_writing' }] })
    expect(
      acceptRoutingTableProposal(env.ctx, { proposalId: other, caller: 'desktop_user' }).ok
    ).toBe(true)
    expect(
      acceptRoutingTableProposal(env.ctx, { proposalId: first, caller: 'desktop_user' })
    ).toMatchObject({
      ok: false,
      reason: 'proposal_superseded'
    })
    const active = resolveActiveRoutingTable(env.ctx)
    expect(active.ok).toBe(true)
    const rebased = submitRoutingTableProposal(
      env.ctx,
      submission(env, { base: { table_version: 2, sha256: active.ok ? active.sha256 : '' } }),
      'agent'
    )
    expect(rebased.ok).toBe(true)
  })

  it('caps the pending proposals an agent can leave, but not the app', () => {
    const env = installed()
    const effortLevels = ['low', 'medium', 'high', 'xhigh']
    const models = ['gpt-6-astra', 'gpt-6.1-sol']
    const rows = effortLevels.flatMap((level) =>
      models.map((model) => ({ ...ASTRA_ROW, model, reasoning_level: level }))
    )
    const types = ['software_engineering', 'high_quality_writing']
    const variants = types.flatMap((task_type) => rows.map((row) => ({ ...row, task_type })))
    const results = variants.map((row) =>
      submitRoutingTableProposal(env.ctx, submission(env, { changes: [row] }), 'agent')
    )
    expect(results.filter((result) => result.ok)).toHaveLength(16)
    const extra = submitRoutingTableProposal(
      env.ctx,
      submission(env, {
        changes: [
          {
            ...ASTRA_ROW,
            reasoning_level: 'xhigh',
            model: 'claude-opus-5-5',
            execution_target: 'claude_subagent'
          }
        ]
      }),
      'agent'
    )
    expect(extra).toMatchObject({ ok: false, reason: 'too_many_pending' })
    const fromApp = submitRoutingTableProposal(
      env.ctx,
      submission(env, {
        proposer: 'benchmark_review',
        changes: [
          {
            ...ASTRA_ROW,
            reasoning_level: 'xhigh',
            model: 'claude-opus-5-5',
            execution_target: 'claude_subagent'
          }
        ]
      }),
      'app'
    )
    expect(fromApp.ok).toBe(true)
  })

  it('refuses while the active table is damaged', () => {
    const env = installed()
    env.fs.files.delete(versionFilePath(1))
    expect(submitRoutingTableProposal(env.ctx, submission(env), 'agent')).toMatchObject({
      ok: false,
      reason: 'routing_table_integrity_failed'
    })
  })
})

describe('accepting a proposal', () => {
  it('writes the next version file, then the index, then records the decision', () => {
    const env = installed()
    const id = submitOk(env)
    env.fs.writeLog.length = 0
    const result = acceptRoutingTableProposal(env.ctx, { proposalId: id, caller: 'desktop_user' })
    expect(result).toMatchObject({ ok: true, version: 2 })
    expect(env.fs.writeLog).toEqual([versionFilePath(2), INDEX_FILE_PATH, proposalPath(id)])
    const active = resolveActiveRoutingTable(env.ctx)
    const row = active.ok
      ? active.table.routes.find((route) => route.task_type === 'software_engineering')
      : null
    expect(row).toMatchObject({
      execution_target: 'codex_cli',
      model: 'gpt-6-astra',
      reasoning_level: 'max'
    })
    expect(active.ok && active.table.based_on).toEqual(env.base)
    expect(active.ok && active.source).toBe('user')
    const entry = listRoutingTableProposals(env.ctx).entries[0]
    expect(entry?.decision).toMatchObject({
      decision: 'accepted',
      decided_by: 'desktop_user',
      resulting: { table_version: 2 }
    })
  })

  it('applies the coordinator and validation changes of a proposal', () => {
    const env = installed()
    const id = submitOk(env, {
      changes: [],
      coordinator: { agent: 'claude', model: 'claude-opus-5-5', reasoning_level: 'high' },
      validation: {
        reviewers: [{ target: 'claude_headless', model: 'claude-opus-5-5', reasoning_level: 'max' }]
      }
    })
    expect(acceptRoutingTableProposal(env.ctx, { proposalId: id, caller: 'desktop_user' }).ok).toBe(
      true
    )
    const active = resolveActiveRoutingTable(env.ctx)
    expect(active.ok && active.table.coordinator.reasoning_level).toBe('high')
    expect(active.ok && active.table.validation.reviewers).toHaveLength(1)
  })

  it('keeps the rows the proposal does not mention', () => {
    const env = installed()
    const id = submitOk(env)
    acceptRoutingTableProposal(env.ctx, { proposalId: id, caller: 'desktop_user' })
    const active = resolveActiveRoutingTable(env.ctx)
    const before = getBundledRoutingTable().routes
    const after = active.ok ? active.table.routes : []
    expect(after.filter((route) => route.task_type !== 'software_engineering')).toEqual(
      before.filter((route) => route.task_type !== 'software_engineering')
    )
  })

  it.each(['agent', 'app', 'dot', 'system', '', undefined, null])(
    'is refused for the caller %j: only the desktop user accepts',
    (caller) => {
      const env = installed()
      const id = submitOk(env)
      env.fs.writeLog.length = 0
      expect(acceptRoutingTableProposal(env.ctx, { proposalId: id, caller })).toEqual({
        ok: false,
        reason: 'forbidden_caller'
      })
      expect(env.fs.writeLog).toEqual([])
      const active = resolveActiveRoutingTable(env.ctx)
      expect(active.ok && active.version).toBe(1)
    }
  )

  it('cannot be done by the agent that proposed it', () => {
    const env = installed()
    const id = submitOk(env, {}, 'agent')
    expect(acceptRoutingTableProposal(env.ctx, { proposalId: id, caller: 'agent' })).toMatchObject({
      ok: false,
      reason: 'forbidden_caller'
    })
    expect(listRoutingTableProposals(env.ctx).entries[0]?.decision).toBeNull()
  })

  it('records a stale base as superseded and writes no version', () => {
    const env = installed()
    const first = submitOk(env)
    const second = submitOk(env, { changes: [{ ...ASTRA_ROW, task_type: 'high_quality_writing' }] })
    acceptRoutingTableProposal(env.ctx, { proposalId: second, caller: 'desktop_user' })
    env.fs.writeLog.length = 0
    expect(
      listRoutingTableProposals(env.ctx).entries.find((e) => e.proposal.proposal_id === first)
        ?.stale
    ).toBe(true)
    const result = acceptRoutingTableProposal(env.ctx, {
      proposalId: first,
      caller: 'desktop_user'
    })
    expect(result).toEqual({ ok: false, reason: 'proposal_superseded' })
    expect(env.fs.writeLog).toEqual([proposalPath(first)])
    const entry = listRoutingTableProposals(env.ctx).entries.find(
      (e) => e.proposal.proposal_id === first
    )
    expect(entry?.decision).toMatchObject({ decision: 'superseded', resulting: null })
    expect(env.fs.files.has(versionFilePath(3))).toBe(false)
  })

  it('refuses a second decision on the same proposal', () => {
    const env = installed()
    const id = submitOk(env)
    acceptRoutingTableProposal(env.ctx, { proposalId: id, caller: 'desktop_user' })
    expect(
      acceptRoutingTableProposal(env.ctx, { proposalId: id, caller: 'desktop_user' })
    ).toMatchObject({
      ok: false,
      reason: 'already_decided'
    })
    expect(
      rejectRoutingTableProposal(env.ctx, { proposalId: id, caller: 'desktop_user' })
    ).toMatchObject({
      ok: false,
      reason: 'already_decided'
    })
  })

  it('accepts a user-modified change set as accepted_modified with source user', () => {
    const env = installed()
    const id = submitOk(env)
    const result = acceptRoutingTableProposal(env.ctx, {
      proposalId: id,
      caller: 'desktop_user',
      modification: {
        changes: [{ ...ASTRA_ROW, reasoning_level: 'high', notes: 'Edited by the user.' }]
      }
    })
    expect(result).toMatchObject({ ok: true, version: 2 })
    const active = resolveActiveRoutingTable(env.ctx)
    const row = active.ok
      ? active.table.routes.find((route) => route.task_type === 'software_engineering')
      : null
    expect(row).toMatchObject({ reasoning_level: 'high', notes: 'Edited by the user.' })
    expect(listRoutingTableProposals(env.ctx).entries[0]?.decision?.decision).toBe(
      'accepted_modified'
    )
  })

  it('treats a modification as the whole change set, so an empty one changes nothing', () => {
    const env = installed()
    const id = submitOk(env)
    env.fs.writeLog.length = 0
    expect(
      acceptRoutingTableProposal(env.ctx, {
        proposalId: id,
        caller: 'desktop_user',
        modification: {}
      })
    ).toEqual({ ok: false, reason: 'no_change' })
    expect(env.fs.writeLog).toEqual([])
    expect(listRoutingTableProposals(env.ctx).entries[0]?.decision).toBeNull()
  })

  it('refuses a modification that breaks a rule, leaving the proposal pending', () => {
    const env = installed()
    const id = submitOk(env)
    env.fs.writeLog.length = 0
    for (const changes of [
      [{ ...ASTRA_ROW, model: 'invalid model' }],
      [{ ...ASTRA_ROW, notes: '修改' }],
      [{ ...ASTRA_ROW, model: 'latest' }]
    ]) {
      expect(
        acceptRoutingTableProposal(env.ctx, {
          proposalId: id,
          caller: 'desktop_user',
          modification: { changes }
        })
      ).toMatchObject({ ok: false, reason: 'invalid_table' })
    }
    expect(env.fs.writeLog).toEqual([])
    expect(listRoutingTableProposals(env.ctx).entries[0]?.decision).toBeNull()
  })

  it('re-validates the stored proposal and refuses one edited on disk', () => {
    const env = installed()
    const id = submitOk(env)
    const stored = env.fs.files.get(proposalPath(id)) ?? ''
    env.fs.files.set(proposalPath(id), stored.replace('gpt-6-astra', 'invalid model'))
    env.fs.writeLog.length = 0
    expect(
      acceptRoutingTableProposal(env.ctx, { proposalId: id, caller: 'desktop_user' })
    ).toMatchObject({
      ok: false,
      reason: 'proposal_invalid'
    })
    expect(env.fs.writeLog).toEqual([])
  })

  it('refuses an unknown or path-like proposal id', () => {
    const env = installed()
    for (const proposalId of ['proposal-9999', '../index', '', 'x'.repeat(65)]) {
      expect(
        acceptRoutingTableProposal(env.ctx, { proposalId, caller: 'desktop_user' })
      ).toMatchObject({
        ok: false,
        reason: 'proposal_unknown'
      })
    }
  })

  it('refuses while the active table is damaged, and when the classifier taxonomy moved on', () => {
    const env = installed()
    const id = submitOk(env)
    const moved = createTestRoutingTableEnvironment({ fs: env.fs, expectedTaxonomyVersion: 3 })
    expect(
      acceptRoutingTableProposal(moved.ctx, { proposalId: id, caller: 'desktop_user' })
    ).toMatchObject({
      ok: false,
      reason: 'routing_table_taxonomy_mismatch'
    })
    env.fs.files.delete(versionFilePath(1))
    expect(
      acceptRoutingTableProposal(env.ctx, { proposalId: id, caller: 'desktop_user' })
    ).toMatchObject({
      ok: false,
      reason: 'routing_table_integrity_failed'
    })
  })
})

describe('rejecting a proposal', () => {
  it('records the rejection and changes nothing else', () => {
    const env = installed()
    const id = submitOk(env)
    env.fs.writeLog.length = 0
    expect(rejectRoutingTableProposal(env.ctx, { proposalId: id, caller: 'desktop_user' })).toEqual(
      { ok: true }
    )
    expect(env.fs.writeLog).toEqual([proposalPath(id)])
    expect(listRoutingTableProposals(env.ctx).entries[0]?.decision).toMatchObject({
      decision: 'rejected',
      resulting: null,
      decided_by: 'desktop_user'
    })
    const active = resolveActiveRoutingTable(env.ctx)
    expect(active.ok && active.version).toBe(1)
  })

  it.each(['agent', 'app', 'dot', undefined])('is refused for the caller %j', (caller) => {
    const env = installed()
    const id = submitOk(env)
    env.fs.writeLog.length = 0
    expect(rejectRoutingTableProposal(env.ctx, { proposalId: id, caller })).toEqual({
      ok: false,
      reason: 'forbidden_caller'
    })
    expect(env.fs.writeLog).toEqual([])
  })

  it('refuses an unknown id', () => {
    const env = installed()
    expect(
      rejectRoutingTableProposal(env.ctx, { proposalId: 'proposal-9999', caller: 'desktop_user' })
    ).toMatchObject({
      ok: false,
      reason: 'proposal_unknown'
    })
  })
})

describe('listing proposals', () => {
  it('reports unreadable proposal files by id instead of failing the list', () => {
    const env = installed()
    submitOk(env)
    env.fs.files.set(proposalPath('proposal-0099'), '{broken')
    const listed = listRoutingTableProposals(env.ctx)
    expect(listed.entries).toHaveLength(1)
    expect(listed.unreadable).toEqual(['proposal-0099'])
  })
})

describe('bundled updates arrive as proposals', () => {
  function bundledVersion(version: number, reasoningLevel: string): RoutingTable {
    const base = getBundledRoutingTable()
    return RoutingTableSchema.parse({
      ...base,
      table_version: version,
      routes: base.routes.map((route) =>
        route.task_type === 'routine_analysis_batch'
          ? { ...route, reasoning_level: reasoningLevel }
          : route
      )
    })
  }

  it('proposes nothing at first start, when the bundled table was just installed', () => {
    const env = installed()
    expect(proposeBundledUpdate(env.ctx)).toEqual({ ok: true, proposalId: null })
    expect(listRoutingTableProposals(env.ctx).entries).toEqual([])
  })

  it('proposes a newer bundled table once, against the active version', () => {
    const first = installed()
    const updated = createTestRoutingTableEnvironment({
      fs: first.fs,
      bundled: bundledVersion(2, 'max')
    })
    const result = proposeBundledUpdate(updated.ctx)
    expect(result).toEqual({ ok: true, proposalId: 'bundled-v2' })
    const entry = listRoutingTableProposals(updated.ctx).entries[0]
    expect(entry?.proposal).toMatchObject({ proposer: 'bundled_update', base: first.base })
    expect(entry?.proposal.changes.map((route) => route.task_type)).toEqual([
      'routine_analysis_batch'
    ])
    expect(proposeBundledUpdate(updated.ctx)).toEqual({ ok: true, proposalId: null })
    expect(listRoutingTableProposals(updated.ctx).entries).toHaveLength(1)
  })

  it('does not propose again after the user rejected it, on the next start', () => {
    const first = installed()
    const updated = createTestRoutingTableEnvironment({
      fs: first.fs,
      bundled: bundledVersion(2, 'max')
    })
    proposeBundledUpdate(updated.ctx)
    rejectRoutingTableProposal(updated.ctx, { proposalId: 'bundled-v2', caller: 'desktop_user' })
    const nextStart = createTestRoutingTableEnvironment({
      fs: first.fs,
      bundled: bundledVersion(2, 'max')
    })
    expect(proposeBundledUpdate(nextStart.ctx)).toEqual({ ok: true, proposalId: null })
    expect(listRoutingTableProposals(nextStart.ctx).entries).toHaveLength(1)
  })

  it('does not propose a newer bundled version whose content equals the active table', () => {
    const first = installed()
    const sameContent = createTestRoutingTableEnvironment({
      fs: first.fs,
      bundled: RoutingTableSchema.parse({ ...getBundledRoutingTable(), table_version: 3 })
    })
    expect(proposeBundledUpdate(sameContent.ctx)).toEqual({ ok: true, proposalId: null })
    expect(listRoutingTableProposals(sameContent.ctx).entries).toEqual([])
    const later = createTestRoutingTableEnvironment({
      fs: first.fs,
      bundled: RoutingTableSchema.parse({ ...getBundledRoutingTable(), table_version: 3 })
    })
    expect(proposeBundledUpdate(later.ctx)).toEqual({ ok: true, proposalId: null })
  })

  it('recovers from a crash between the proposal write and the seen mark without offering twice', () => {
    const first = installed()
    const updated = createTestRoutingTableEnvironment({
      fs: first.fs,
      bundled: bundledVersion(2, 'max')
    })
    proposeBundledUpdate(updated.ctx)
    const index = JSON.parse(first.fs.files.get(INDEX_FILE_PATH) ?? '{}')
    first.fs.files.set(INDEX_FILE_PATH, JSON.stringify({ ...index, bundled_version_seen: 1 }))
    expect(proposeBundledUpdate(updated.ctx)).toEqual({ ok: true, proposalId: null })
    expect(listRoutingTableProposals(updated.ctx).entries).toHaveLength(1)
    const marked = JSON.parse(first.fs.files.get(INDEX_FILE_PATH) ?? '{}')
    expect(marked.bundled_version_seen).toBe(2)
  })

  it('refuses to offer a bundled table of another taxonomy', () => {
    const first = installed()
    const otherTaxonomy = RoutingTableSchema.parse({
      ...getBundledRoutingTable(),
      table_version: 2,
      taxonomy_version: 3
    })
    const updated = createTestRoutingTableEnvironment({ fs: first.fs, bundled: otherTaxonomy })
    expect(proposeBundledUpdate(updated.ctx)).toEqual({
      ok: false,
      reason: 'routing_table_taxonomy_mismatch',
      tableTaxonomyVersion: 3,
      expectedTaxonomyVersion: 2
    })
    expect(listRoutingTableProposals(updated.ctx).entries).toEqual([])
  })

  it('never touches the active table, whatever the bundled table says', () => {
    const first = installed()
    const updated = createTestRoutingTableEnvironment({
      fs: first.fs,
      bundled: bundledVersion(2, 'max')
    })
    proposeBundledUpdate(updated.ctx)
    const active = resolveActiveRoutingTable(updated.ctx)
    expect(active.ok && active.version).toBe(1)
    expect(active.ok && active.sha256).toBe(first.base.sha256)
  })

  it('stays quiet while the store is damaged, and never installs over it', () => {
    const first = installed()
    first.fs.files.delete(versionFilePath(1))
    const updated = createTestRoutingTableEnvironment({
      fs: first.fs,
      bundled: bundledVersion(2, 'max')
    })
    expect(proposeBundledUpdate(updated.ctx)).toMatchObject({
      ok: false,
      reason: 'routing_table_integrity_failed'
    })
    expect(first.fs.writeLog).toEqual([])
  })
})

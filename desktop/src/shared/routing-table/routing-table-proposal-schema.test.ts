import { describe, expect, it } from 'vitest'
import {
  ProposalDecisionSchema,
  ProposalSubmissionSchema,
  RoutingTableProposalSchema,
  StoredProposalSchema
} from './routing-table-proposal-schema'

const SHA = 'a'.repeat(64)
const OTHER_SHA = 'b'.repeat(64)

const ROUTE = {
  task_type: 'software_engineering',
  execution_target: 'codex_cli',
  model: 'gpt-6-astra',
  reasoning_level: 'max'
}

function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    proposer: 'agent',
    base: { table_version: 1, sha256: SHA },
    changes: [ROUTE],
    rationale: 'A newer model is available and leads the engineering benchmarks.',
    evidence: [{ name: 'Artificial Analysis', url: 'https://artificialanalysis.ai/' }],
    ...overrides
  }
}

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...submission(),
    proposal_id: 'proposal-0001',
    created_at: '2026-10-04T10:00:00Z',
    ...overrides
  }
}

describe('RoutingTableProposalSchema', () => {
  it('accepts a proposal with whole replacement rows', () => {
    expect(RoutingTableProposalSchema.safeParse(proposal()).success).toBe(true)
  })

  it('accepts a coordinator, validation or benchmark date change on its own', () => {
    const coordinator = { model: 'claude-opus-5-5', reasoning_level: 'high' }
    expect(
      RoutingTableProposalSchema.safeParse(proposal({ changes: [], coordinator })).success
    ).toBe(true)
    const validation = { reviewers: [] }
    expect(
      RoutingTableProposalSchema.safeParse(
        proposal({ changes: [], validation, benchmark_snapshot_date: '2026-10-01' })
      ).success
    ).toBe(true)
  })

  it.each(['bundled_update', 'benchmark_review', 'agent', 'user_import'])(
    'accepts the proposer %s',
    (proposer) => {
      expect(RoutingTableProposalSchema.safeParse(proposal({ proposer })).success).toBe(true)
    }
  )

  it.each(['desktop_user', 'dot', 'system', ''])('refuses the proposer %j', (proposer) => {
    expect(RoutingTableProposalSchema.safeParse(proposal({ proposer })).success).toBe(false)
  })

  it('refuses a Gemini 4 id, an alias and an inherit on a proposed row', () => {
    for (const model of ['gemini-4-flash', 'sonnet', 'latest']) {
      const changes = [{ ...ROUTE, model }]
      expect(RoutingTableProposalSchema.safeParse(proposal({ changes })).success).toBe(false)
    }
    const inheriting = [{ ...ROUTE, model: 'inherit', reasoning_level: 'inherit' }]
    expect(RoutingTableProposalSchema.safeParse(proposal({ changes: inheriting })).success).toBe(
      false
    )
  })

  it('refuses a Gemini 4 coordinator in a proposal', () => {
    const coordinator = { model: 'gemini-4', reasoning_level: 'max' }
    expect(RoutingTableProposalSchema.safeParse(proposal({ coordinator })).success).toBe(false)
  })

  it('refuses two changes for the same task type and an unknown task type', () => {
    expect(
      RoutingTableProposalSchema.safeParse(proposal({ changes: [ROUTE, { ...ROUTE }] })).success
    ).toBe(false)
    const unknown = [{ ...ROUTE, task_type: 'needs_clarification' }]
    expect(RoutingTableProposalSchema.safeParse(proposal({ changes: unknown })).success).toBe(false)
  })

  it('requires an English rationale of at most 2000 characters (D-013)', () => {
    expect(RoutingTableProposalSchema.safeParse(proposal({ rationale: '更新模型' })).success).toBe(
      false
    )
    expect(RoutingTableProposalSchema.safeParse(proposal({ rationale: '' })).success).toBe(false)
    expect(
      RoutingTableProposalSchema.safeParse(proposal({ rationale: 'x'.repeat(2001) })).success
    ).toBe(false)
    expect(
      RoutingTableProposalSchema.safeParse(proposal({ rationale: 'x'.repeat(2000) })).success
    ).toBe(true)
  })

  it('requires English notes on proposed rows', () => {
    const changes = [{ ...ROUTE, notes: 'Pour les tâches de génie logiciel — 日本語' }]
    expect(RoutingTableProposalSchema.safeParse(proposal({ changes })).success).toBe(false)
  })

  it('bounds the evidence list and refuses non-https evidence links', () => {
    const many = Array.from({ length: 17 }, () => ({ name: 'Arena' }))
    expect(RoutingTableProposalSchema.safeParse(proposal({ evidence: many })).success).toBe(false)
    const plain = [{ name: 'Arena', url: 'http://arena.ai/' }]
    expect(RoutingTableProposalSchema.safeParse(proposal({ evidence: plain })).success).toBe(false)
  })

  it('refuses a malformed base, id or timestamp and unknown keys', () => {
    expect(
      RoutingTableProposalSchema.safeParse(proposal({ base: { table_version: 0, sha256: SHA } }))
        .success
    ).toBe(false)
    expect(
      RoutingTableProposalSchema.safeParse(proposal({ base: { table_version: 1, sha256: 'xyz' } }))
        .success
    ).toBe(false)
    for (const proposal_id of ['short', '../escape-path', 'has space ok', 'x'.repeat(65)]) {
      expect(RoutingTableProposalSchema.safeParse(proposal({ proposal_id })).success).toBe(false)
    }
    expect(RoutingTableProposalSchema.safeParse(proposal({ created_at: 'today' })).success).toBe(
      false
    )
    expect(RoutingTableProposalSchema.safeParse(proposal({ approved: true })).success).toBe(false)
  })
})

describe('ProposalSubmissionSchema', () => {
  it('has no id or creation time, which the store assigns', () => {
    expect(ProposalSubmissionSchema.safeParse(submission()).success).toBe(true)
    expect(ProposalSubmissionSchema.safeParse(proposal()).success).toBe(false)
  })

  it('applies the same row and rationale rules as a stored proposal', () => {
    const changes = [{ ...ROUTE, model: 'gemini-4' }]
    expect(ProposalSubmissionSchema.safeParse(submission({ changes })).success).toBe(false)
    expect(ProposalSubmissionSchema.safeParse(submission({ rationale: 'п' })).success).toBe(false)
  })
})

describe('ProposalDecisionSchema', () => {
  const decision = {
    proposal_id: 'proposal-0001',
    decision: 'accepted',
    resulting: { table_version: 2, sha256: OTHER_SHA },
    decided_at: '2026-10-04T11:00:00Z',
    decided_by: 'desktop_user'
  }

  it.each(['accepted', 'accepted_modified'])('requires a resulting version for %s', (value) => {
    expect(ProposalDecisionSchema.safeParse({ ...decision, decision: value }).success).toBe(true)
    expect(
      ProposalDecisionSchema.safeParse({ ...decision, decision: value, resulting: null }).success
    ).toBe(false)
  })

  it.each(['rejected', 'superseded'])('has no resulting version for %s', (value) => {
    expect(
      ProposalDecisionSchema.safeParse({ ...decision, decision: value, resulting: null }).success
    ).toBe(true)
    expect(ProposalDecisionSchema.safeParse({ ...decision, decision: value }).success).toBe(false)
  })

  it('can only be decided by the desktop user', () => {
    for (const decided_by of ['agent', 'dot', 'app', '']) {
      expect(ProposalDecisionSchema.safeParse({ ...decision, decided_by }).success).toBe(false)
    }
  })

  it('refuses an unknown decision value', () => {
    expect(
      ProposalDecisionSchema.safeParse({ ...decision, decision: 'auto_accepted' }).success
    ).toBe(false)
  })
})

describe('StoredProposalSchema', () => {
  it('holds the proposal, its content hash and an optional decision', () => {
    const stored = { schema_version: 1, proposal: proposal(), content_sha256: SHA, decision: null }
    expect(StoredProposalSchema.safeParse(stored).success).toBe(true)
    expect(StoredProposalSchema.safeParse({ ...stored, content_sha256: 'nope' }).success).toBe(
      false
    )
    expect(StoredProposalSchema.safeParse({ ...stored, extra: 1 }).success).toBe(false)
  })

  it('refuses a decision that names another proposal', () => {
    const stored = {
      schema_version: 1,
      proposal: proposal(),
      content_sha256: SHA,
      decision: {
        proposal_id: 'proposal-9999',
        decision: 'rejected',
        resulting: null,
        decided_at: '2026-10-04T11:00:00Z',
        decided_by: 'desktop_user'
      }
    }
    expect(StoredProposalSchema.safeParse(stored).success).toBe(false)
  })
})

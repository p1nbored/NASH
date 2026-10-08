import { describe, expect, it } from 'vitest'
import { parseImportedChangeSet } from './routing-table-import-parse'
import { FIXTURE_SHA_V3 } from './routing-table-view.test-fixture'

const ACTIVE = { version: 3, sha256: FIXTURE_SHA_V3 }
const ROW = {
  task_type: 'software_engineering',
  execution_target: 'codex_cli',
  model: 'gpt-6-astra',
  reasoning_level: 'max'
}

describe('parseImportedChangeSet', () => {
  it('records a pasted change set as the user import, based on the active version', () => {
    const result = parseImportedChangeSet(
      JSON.stringify({ changes: [ROW] }),
      'Prefer Astra.',
      ACTIVE
    )

    expect(result).toEqual({
      ok: true,
      submission: {
        schema_version: 1,
        proposer: 'user_import',
        base: { table_version: 3, sha256: FIXTURE_SHA_V3 },
        changes: [{ ...ROW, reasoning_requirement: 'required' }],
        rationale: 'Prefer Astra.',
        evidence: []
      }
    })
  })

  it('keeps an exported proposal content but makes it the user import', () => {
    const exported = {
      schema_version: 1,
      proposer: 'agent',
      base: { table_version: 3, sha256: FIXTURE_SHA_V3 },
      changes: [ROW],
      rationale: 'Agent reason.',
      evidence: [{ name: 'Arena' }]
    }

    const result = parseImportedChangeSet(JSON.stringify(exported), '', ACTIVE)

    expect(result.ok && result.submission.proposer).toBe('user_import')
    expect(result.ok && result.submission.rationale).toBe('Agent reason.')
    expect(result.ok && result.submission.evidence).toEqual([{ name: 'Arena' }])
  })

  it('explains malformed JSON, a missing reason and an invalid row in plain English', () => {
    const notJson = parseImportedChangeSet('{ changes: ', 'Reason.', ACTIVE)
    const noReason = parseImportedChangeSet(JSON.stringify({ changes: [ROW] }), ' ', ACTIVE)
    const badRow = parseImportedChangeSet(
      JSON.stringify({ changes: [{ ...ROW, model: 'latest' }] }),
      'Reason.',
      ACTIVE
    )

    expect(notJson).toEqual({ ok: false, message: expect.stringMatching(/not valid JSON/i) })
    expect(noReason).toEqual({ ok: false, message: expect.stringMatching(/reason/i) })
    expect(badRow.ok).toBe(false)
    expect(!badRow.ok && badRow.message).toMatch(/agent, model and effort/)
    expect(!badRow.ok && badRow.message).not.toMatch(/changes 1/)
    expect(!badRow.ok && badRow.details).toBe('invalid_at: changes 1 model')
  })

  it('needs routing in use to base the change on', () => {
    const result = parseImportedChangeSet(JSON.stringify({ changes: [ROW] }), 'Reason.', null)

    expect(result).toEqual({ ok: false, message: expect.stringMatching(/not available/i) })
  })
})

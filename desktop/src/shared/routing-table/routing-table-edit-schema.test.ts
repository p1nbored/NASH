import { describe, expect, it } from 'vitest'
import { RoutingTableEditSchema } from './routing-table-edit-schema'

const base = { table_version: 1, sha256: 'a'.repeat(64) }
const route = {
  task_type: 'software_engineering',
  execution_target: 'codex_cli',
  model: 'gpt-6-astra',
  reasoning_level: 'high'
}

describe('direct routing edits', () => {
  it('rejects repeated replacement rows instead of choosing an arbitrary one', () => {
    expect(
      RoutingTableEditSchema.safeParse({
        base,
        changes: [route, { ...route, model: 'gpt-6.1-sol' }]
      }).success
    ).toBe(false)
  })

  it('requires a version and hash and rejects former proposal metadata', () => {
    expect(RoutingTableEditSchema.safeParse({ changes: [route] }).success).toBe(false)
    expect(
      RoutingTableEditSchema.safeParse({ base: { ...base, sha256: 'bad' }, changes: [route] })
        .success
    ).toBe(false)
    expect(
      RoutingTableEditSchema.safeParse({ base, changes: [route], proposer: 'user_import' }).success
    ).toBe(false)
  })

  it('applies exact-model and target validation to reviewer edits', () => {
    const reviewer = { target: 'codex_cli', model: 'gpt-6.1-sol', reasoning_level: 'high' }
    expect(
      RoutingTableEditSchema.safeParse({ base, validation: { reviewers: [reviewer] } }).success
    ).toBe(true)
    for (const edit of [
      { model: 'latest' },
      { target: 'claude_primary' },
      { reasoning_level: 'inherit' }
    ]) {
      expect(
        RoutingTableEditSchema.safeParse({
          base,
          validation: { reviewers: [{ ...reviewer, ...edit }] }
        }).success
      ).toBe(false)
    }
  })
})

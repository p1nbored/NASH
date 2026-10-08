import { describe, expect, it } from 'vitest'
import {
  changesFromDraft,
  draftFromTable,
  withCoordinatorAgent,
  withRouteEdit
} from './routing-table-editor-model'
import { fixtureProposal, fixtureTable } from './routing-table-view.test-fixture'

describe('routing table editor model', () => {
  it('starts from the active table with a proposal applied on top', () => {
    const draft = draftFromTable(fixtureTable(), fixtureProposal())

    const engineering = draft.routes.find((row) => row.taskType === 'software_engineering')
    expect(engineering).toMatchObject({
      target: 'codex_cli',
      model: 'gpt-6-astra',
      reasoningLevel: 'max'
    })
    expect(draft.routes).toHaveLength(10)
    expect(draft.coordinator).toEqual({
      agent: 'claude',
      model: 'claude-opus-5-5',
      reasoningLevel: 'max'
    })
  })

  it('turns an untouched proposal draft back into the same change set', () => {
    const active = fixtureTable()
    const proposal = fixtureProposal()

    const result = changesFromDraft(active, draftFromTable(active, proposal))

    expect(result).toEqual({ ok: true, changes: { changes: proposal.changes } })
  })

  it('keeps only rows that differ from the active table, with the user row bare', () => {
    const active = fixtureTable()
    const draft = withRouteEdit(draftFromTable(active, fixtureProposal()), 'software_engineering', {
      model: 'gpt-6.1-sol',
      reasoningLevel: 'high'
    })

    const result = changesFromDraft(active, draft)

    expect(result).toEqual({
      ok: true,
      changes: {
        changes: [
          {
            task_type: 'software_engineering',
            execution_target: 'codex_cli',
            model: 'gpt-6.1-sol',
            reasoning_level: 'high',
            reasoning_requirement: 'required'
          }
        ]
      }
    })
  })

  it('carries a proposed reviewer list through unchanged', () => {
    const active = fixtureTable()
    const validation = {
      reviewers: [
        {
          target: 'claude_headless' as const,
          model: 'claude-opus-5-5',
          reasoning_level: 'high' as const
        }
      ]
    }
    const proposal = fixtureProposal({ validation })

    const result = changesFromDraft(active, draftFromTable(active, proposal))

    expect(result.ok && result.changes.validation).toEqual(validation)
  })

  it('refuses aliases but accepts an exact Gemini 4 model for availability checking', () => {
    const active = fixtureTable()
    const alias = withRouteEdit(draftFromTable(active), 'software_engineering', { model: 'opus' })
    const gemini4 = withRouteEdit(draftFromTable(active), 'fast_writing_or_alternative_draft', {
      model: 'gemini-4-flash'
    })

    const aliasResult = changesFromDraft(active, alias)
    const geminiResult = changesFromDraft(active, gemini4)

    expect(aliasResult.ok).toBe(false)
    expect(!aliasResult.ok && aliasResult.errors[0]).toMatchObject({
      field: 'software_engineering'
    })
    expect(!aliasResult.ok && aliasResult.errors[0].message).toMatch(/exact model ID/i)
    expect(geminiResult.ok).toBe(true)
  })

  it('explains the table rules in plain English', () => {
    const active = fixtureTable()
    const draft = withRouteEdit(draftFromTable(active), 'software_engineering', {
      model: 'inherit',
      reasoningLevel: 'inherit'
    })

    const result = changesFromDraft(active, draft)

    expect(!result.ok && result.errors[0].message).toMatch(/only the primary session/i)
  })

  it('says when the draft leaves the active table unchanged', () => {
    const active = fixtureTable()

    const result = changesFromDraft(active, draftFromTable(active))

    expect(result).toEqual({ ok: false, errors: [{ field: 'table', message: expect.any(String) }] })
  })

  it('validates and includes an edited coordinator', () => {
    const active = fixtureTable()
    const draft = {
      ...draftFromTable(active),
      coordinator: { agent: 'claude' as const, model: 'sonnet', reasoningLevel: 'max' as const }
    }

    const invalid = changesFromDraft(active, draft)
    const valid = changesFromDraft(active, {
      ...draft,
      coordinator: { agent: 'claude', model: 'claude-opus-5-5', reasoningLevel: 'xhigh' }
    })

    expect(!invalid.ok && invalid.errors[0].field).toBe('coordinator')
    expect(valid.ok && valid.changes.coordinator).toEqual({
      agent: 'claude',
      model: 'claude-opus-5-5',
      reasoning_level: 'xhigh'
    })
  })

  it('keeps the selected Claude draft unchanged and clears the model on a CLI switch', () => {
    const active = fixtureTable()
    const draft = draftFromTable(active)
    expect(withCoordinatorAgent(draft.coordinator, 'claude')).toBe(draft.coordinator)
    const coordinator = withCoordinatorAgent(draft.coordinator, 'codex')
    expect(coordinator).toEqual({ agent: 'codex', model: '', reasoningLevel: 'max' })
    expect(changesFromDraft(active, { ...draft, coordinator }).ok).toBe(false)
    expect(withCoordinatorAgent({ ...coordinator, model: 'gpt-6-astra' }, 'claude')).toEqual({
      agent: 'claude',
      model: '',
      reasoningLevel: 'max'
    })
  })

  it('preserves the primary CLI in proposed and edited coordinator configurations', () => {
    const active = fixtureTable()
    const coordinator = {
      agent: 'codex' as const,
      model: 'gpt-6-astra',
      reasoning_level: 'high' as const
    }
    const draft = draftFromTable(active, { changes: [], coordinator })
    expect(draft.coordinator).toEqual({
      agent: 'codex',
      model: 'gpt-6-astra',
      reasoningLevel: 'high'
    })
    expect(changesFromDraft(active, draft)).toEqual({
      ok: true,
      changes: { coordinator, changes: [] }
    })
    expect(changesFromDraft({ ...active, coordinator }, draft).ok).toBe(false)
  })
})

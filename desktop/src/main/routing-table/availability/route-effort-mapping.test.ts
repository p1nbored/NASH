import { describe, expect, it } from 'vitest'
import {
  claudeDeliveryFor,
  mapAgyEffort,
  mapClaudeEffort,
  mapCodexEffort
} from './route-effort-mapping'

const CLAUDE_LISTED = ['low', 'medium', 'high', 'xhigh', 'max']
const CODEX_LISTED = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']

describe('claudeDeliveryFor', () => {
  it('passes the effort at session launch for the primary and the headless reviewer', () => {
    expect(claudeDeliveryFor('claude_primary', true)).toBe('claude_effort_flag')
    expect(claudeDeliveryFor('claude_headless', false)).toBe('claude_effort_flag')
  })

  it('puts a subagent effort into its agents entry', () => {
    expect(claudeDeliveryFor('claude_subagent', false)).toBe('claude_agents_field')
  })

  it('sends nothing for a workflow: it inherits, or the workflow defines its own', () => {
    expect(claudeDeliveryFor('claude_workflow', true)).toBe('claude_inherited')
    expect(claudeDeliveryFor('claude_workflow', false)).toBe('claude_workflow_definition')
  })
})

describe('mapClaudeEffort', () => {
  it.each(CLAUDE_LISTED)('sends %s when the model lists it', (level) => {
    expect(
      mapClaudeEffort({
        level,
        requirement: 'required',
        delivery: 'claude_effort_flag',
        listedEfforts: CLAUDE_LISTED
      })
    ).toEqual({
      status: 'resolved',
      effort: level,
      delivery: 'claude_effort_flag',
      resolution: 'applied'
    })
  })

  it('refuses a level the model does not list, and never swaps in another one', () => {
    expect(
      mapClaudeEffort({
        level: 'max',
        requirement: 'required',
        delivery: 'claude_effort_flag',
        listedEfforts: ['low', 'medium', 'high']
      })
    ).toEqual({ status: 'unsupported' })
  })

  it('refuses every level on a model with no effort control (Haiku 4.5)', () => {
    for (const level of CLAUDE_LISTED) {
      expect(
        mapClaudeEffort({
          level,
          requirement: 'required',
          delivery: 'claude_agents_field',
          listedEfforts: []
        })
      ).toEqual({ status: 'unsupported' })
    }
  })

  it('sends ultra, none or minimal to a subagent when the model lists it, and refuses it otherwise (D-027)', () => {
    for (const level of ['ultra', 'none', 'minimal']) {
      const input = { level, requirement: 'required', delivery: 'claude_agents_field' } as const
      expect(mapClaudeEffort({ ...input, listedEfforts: [...CLAUDE_LISTED, level] })).toEqual({
        status: 'resolved',
        effort: level,
        delivery: 'claude_agents_field',
        resolution: 'applied'
      })
      expect(mapClaudeEffort({ ...input, listedEfforts: CLAUDE_LISTED })).toEqual({
        status: 'unsupported'
      })
    }
  })

  it('keeps a listed ultra, none or minimal off the session flag, which its launchers cannot apply', () => {
    for (const level of ['ultra', 'none', 'minimal']) {
      const listedEfforts = [...CLAUDE_LISTED, level]
      expect(
        mapClaudeEffort({
          level,
          requirement: 'required',
          delivery: 'claude_effort_flag',
          listedEfforts
        })
      ).toEqual({ status: 'unsupported' })
      expect(
        mapClaudeEffort({
          level,
          requirement: 'if_supported',
          delivery: 'claude_effort_flag',
          listedEfforts
        })
      ).toEqual({
        status: 'resolved',
        effort: null,
        delivery: 'omitted',
        resolution: 'omitted_unsupported'
      })
    }
  })

  it('sends nothing for an if_supported level the model cannot take, and records why', () => {
    expect(
      mapClaudeEffort({
        level: 'high',
        requirement: 'if_supported',
        delivery: 'claude_agents_field',
        listedEfforts: []
      })
    ).toEqual({
      status: 'resolved',
      effort: null,
      delivery: 'omitted',
      resolution: 'omitted_unsupported'
    })
  })

  it('is unverified when no listed model carries effort data at all', () => {
    expect(
      mapClaudeEffort({
        level: 'max',
        requirement: 'if_supported',
        delivery: 'claude_effort_flag',
        listedEfforts: null
      })
    ).toEqual({ status: 'unverified' })
  })

  it('keeps the level but sends nothing when the work inherits the session configuration', () => {
    expect(
      mapClaudeEffort({
        level: 'max',
        requirement: 'required',
        delivery: 'claude_inherited',
        listedEfforts: CLAUDE_LISTED
      })
    ).toEqual({
      status: 'resolved',
      effort: null,
      delivery: 'claude_inherited',
      resolution: 'applied'
    })
  })
})

describe('mapCodexEffort', () => {
  it.each(['low', 'medium', 'high', 'xhigh', 'max'])(
    'passes %s explicitly through the config override',
    (level) => {
      expect(mapCodexEffort({ level, listedEfforts: CODEX_LISTED })).toEqual({
        status: 'resolved',
        effort: level,
        delivery: 'codex_config_override',
        resolution: 'applied'
      })
    }
  )

  it.each([
    ['ultra', CODEX_LISTED],
    ['minimal', ['minimal', 'low']],
    ['none', ['none']]
  ])('passes %s when the model lists it (D-027)', (level, listedEfforts) => {
    expect(mapCodexEffort({ level, listedEfforts })).toEqual({
      status: 'resolved',
      effort: level,
      delivery: 'codex_config_override',
      resolution: 'applied'
    })
  })

  it('refuses ultra, minimal and none where the model does not list them', () => {
    for (const level of ['ultra', 'minimal', 'none']) {
      expect(mapCodexEffort({ level, listedEfforts: ['low', 'high'] })).toEqual({
        status: 'unsupported'
      })
    }
  })

  it('needs the level in the model listing as well as in the runner set', () => {
    expect(mapCodexEffort({ level: 'max', listedEfforts: ['low', 'medium', 'high'] })).toEqual({
      status: 'unsupported'
    })
    expect(mapCodexEffort({ level: 'high', listedEfforts: [] })).toEqual({ status: 'unsupported' })
  })
})

describe('mapAgyEffort', () => {
  it('encodes the level in the variant id and passes no effort flag', () => {
    expect(
      mapAgyEffort({ level: 'high', requirement: 'if_supported', modelId: 'gemini-3.8-flash-high' })
    ).toEqual({
      status: 'resolved',
      effort: null,
      delivery: 'agy_model_id_variant',
      resolution: 'encoded_in_model_id'
    })
    expect(
      mapAgyEffort({ level: 'low', requirement: 'required', modelId: 'gemini-3.1-pro-low' })
    ).toMatchObject({ status: 'resolved', effort: null })
  })

  it('refuses a required level the pinned variant does not encode, and never swaps the sibling', () => {
    expect(
      mapAgyEffort({ level: 'high', requirement: 'required', modelId: 'gemini-3.8-flash-low' })
    ).toEqual({ status: 'unsupported' })
  })

  it('records an if_supported level the variant does not encode as not applied', () => {
    expect(
      mapAgyEffort({ level: 'high', requirement: 'if_supported', modelId: 'gemini-3.8-flash-low' })
    ).toEqual({
      status: 'resolved',
      effort: null,
      delivery: 'agy_model_id_variant',
      resolution: 'omitted_unsupported'
    })
  })

  it.each(['max', 'xhigh'])('has no %s variant: required refuses it', (level) => {
    expect(
      mapAgyEffort({ level, requirement: 'required', modelId: 'gemini-3.8-flash-high' })
    ).toEqual({ status: 'unsupported' })
  })

  it.each(['ultra', 'minimal', 'none'])(
    'encodes %s when the listed variant id names it (D-027)',
    (level) => {
      expect(
        mapAgyEffort({ level, requirement: 'required', modelId: `gemini-3.8-flash-${level}` })
      ).toMatchObject({ status: 'resolved', resolution: 'encoded_in_model_id', effort: null })
    }
  )

  it('stays unverified for a bare id, because how --effort combines with it is not proven', () => {
    expect(
      mapAgyEffort({ level: 'high', requirement: 'required', modelId: 'gemini-3.8-flash' })
    ).toEqual({ status: 'unverified' })
    expect(
      mapAgyEffort({ level: 'high', requirement: 'if_supported', modelId: 'gemini-3.8-flash' })
    ).toEqual({ status: 'unverified' })
  })

  it('never returns an effort value to send', () => {
    for (const modelId of ['gemini-3.8-flash-high', 'gemini-3.8-flash-low', 'gemini-3.8-flash']) {
      for (const level of ['low', 'medium', 'high', 'max']) {
        for (const requirement of ['required', 'if_supported'] as const) {
          const mapping = mapAgyEffort({ level, requirement, modelId })
          expect(mapping.status === 'resolved' ? mapping.effort : null).toBeNull()
        }
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { parseAntigravityModels } from '../../shared/commit-message-model-parsers'
import { buildAgyExecArgv } from './agy-exec-argv'

// FIXTURE_ONLY: the exact `agy models` output recorded by the read-only G2 probe of agy 1.2.14
// (id, tab, label); no process runs here and no account data is involved.
const AGY_MODELS_OUTPUT = [
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
  'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
  'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
  'gemini-3.6-flash-high\tGemini 3.6 Flash (High)',
  'gemini-3.6-flash-medium\tGemini 3.6 Flash (Medium)',
  'gemini-3.6-flash-low\tGemini 3.6 Flash (Low)',
  'gemini-3.1-pro-high\tGemini 3.1 Pro (High)',
  'gemini-3.1-pro-low\tGemini 3.1 Pro (Low)',
  'claude-opus-5-5-low\tClaude Opus 5.5 (Low)',
  'claude-opus-5-5-medium\tClaude Opus 5.5 (Medium)',
  'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
  'claude-sonnet-5-5-low\tClaude Sonnet 5.5 (Low)',
  'claude-sonnet-5-5-medium\tClaude Sonnet 5.5 (Medium)',
  'claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)'
].join('\n')

const PROMPT = 'Draft a short release note.'

describe('the runner against the real agy model listing', () => {
  const listed = parseAntigravityModels(AGY_MODELS_OUTPUT)

  it('reads all 18 recorded rows with Orca parser', () => {
    expect(listed).toHaveLength(18)
    expect(listed[0]).toEqual({ id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' })
  })

  it('accepts every listed id together with its listed label', () => {
    for (const { id, label } of listed) {
      const argv = buildAgyExecArgv({ sandbox: true, prompt: PROMPT, model: id, modelLabel: label })
      expect(argv).toEqual([`--print=${PROMPT}`, '--sandbox', '--model', id])
    }
  })

  it('refuses a Gemini 4 row if one ever appears in the listing, by id and by label', () => {
    const withGemini4 = parseAntigravityModels(
      `${AGY_MODELS_OUTPUT}\ngemini-4-pro-high\tGemini 4 Pro (High)\ngemini-5-flash-high\tGemini 4 Flash (High)`
    )
    const added = withGemini4.slice(18)
    expect(added).toHaveLength(2)
    for (const { id, label } of added) {
      expect(() =>
        buildAgyExecArgv({ sandbox: true, prompt: PROMPT, model: id, modelLabel: label })
      ).toThrow(/Gemini 4/)
    }
  })

  it('refuses the config-default sentinel that Orca lists first for agy', () => {
    expect(() => buildAgyExecArgv({ sandbox: true, prompt: PROMPT, model: 'default' })).toThrow(
      /default/
    )
  })
})

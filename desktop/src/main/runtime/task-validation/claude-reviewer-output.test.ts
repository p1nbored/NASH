import { describe, expect, it } from 'vitest'
import { parseClaudeResultEnvelope } from './claude-reviewer-output'

const envelope = (fields: Record<string, unknown>): string =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Review text.',
    ...fields
  })

describe('Claude result envelope', () => {
  it('takes the text result and the models the CLI reported serving', () => {
    expect(
      parseClaudeResultEnvelope(
        envelope({ modelUsage: { 'claude-opus-5-5': { outputTokens: 10 } } })
      )
    ).toEqual({ ok: true, text: 'Review text.', reportedModels: ['claude-opus-5-5'] })
    expect(parseClaudeResultEnvelope(`\n${envelope({})}\n`)).toEqual({
      ok: true,
      text: 'Review text.',
      reportedModels: []
    })
  })

  it('refuses an error result, another subtype, a missing result or anything not JSON', () => {
    for (const text of [
      envelope({ is_error: true }),
      envelope({ subtype: 'error_max_turns' }),
      envelope({ type: 'assistant' }),
      envelope({ result: 42 }),
      'Review text.',
      ''
    ]) {
      expect(parseClaudeResultEnvelope(text)).toMatchObject({ ok: false })
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  DOT_MESSAGE_OUTCOMES,
  DOT_MESSAGE_REASONS,
  DOT_MESSAGE_TEXT_MAX_CHARS,
  DotMessageParams,
  DotMessageResultSchema
} from './dot-ingress-message'

const REQUEST_ID = '00000000-0000-4000-8000-000000000001'
const MESSAGE_ID = '00000000-0000-4000-8000-000000000002'

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 2,
    dotRequestId: REQUEST_ID,
    messageId: MESSAGE_ID,
    text: 'Also list the owners of `docs/plan.md`.',
    ...overrides
  }
}

function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 2,
    dotRequestId: REQUEST_ID,
    messageId: MESSAGE_ID,
    outcome: 'delivered',
    reason: null,
    duplicate: false,
    ...overrides
  }
}

describe('dot follow-up message contract (version 2, D-019)', () => {
  it('accepts a message addressed by the dot request id and an idempotent message id', () => {
    expect(DotMessageParams.parse(params())).toEqual(params())
  })

  it('exists only in contract version 2', () => {
    expect(DotMessageParams.safeParse(params({ contractVersion: 1 })).success).toBe(false)
  })

  it('carries no run id, target, permission, access or authority field', () => {
    for (const field of [
      'runId',
      'workflowRunId',
      'terminalHandle',
      'approved',
      'permission',
      'requestedAccess',
      'source',
      'principalId',
      'urgent'
    ]) {
      expect(DotMessageParams.safeParse(params({ [field]: 'x' })).success, field).toBe(false)
    }
  })

  it('requires a uuid message id and some text, and bounds the text before the app checks it', () => {
    expect(DotMessageParams.safeParse(params({ messageId: 'not-a-uuid' })).success).toBe(false)
    expect(DotMessageParams.safeParse(params({ text: '' })).success).toBe(false)
    expect(DOT_MESSAGE_TEXT_MAX_CHARS).toBe(4_000)
    // Why twice the cap: the app counts code points, and a code point is at most two UTF-16 units.
    expect(
      DotMessageParams.safeParse(params({ text: 'a'.repeat(DOT_MESSAGE_TEXT_MAX_CHARS * 2) }))
        .success
    ).toBe(true)
    expect(
      DotMessageParams.safeParse(params({ text: 'a'.repeat(DOT_MESSAGE_TEXT_MAX_CHARS * 2 + 1) }))
        .success
    ).toBe(false)
  })

  it('reports delivered, queued or refused, and a refusal always names a reason', () => {
    expect([...DOT_MESSAGE_OUTCOMES]).toEqual(['delivered', 'queued', 'refused'])
    expect(DotMessageResultSchema.parse(result())).toEqual(result())
    expect(
      DotMessageResultSchema.safeParse(result({ outcome: 'queued', reason: 'agent_busy' })).success
    ).toBe(true)
    expect(
      DotMessageResultSchema.safeParse(result({ outcome: 'refused', reason: null })).success
    ).toBe(false)
    expect(
      DotMessageResultSchema.safeParse(result({ outcome: 'refused', reason: 'not_english' }))
        .success
    ).toBe(true)
  })

  it('uses a closed reason vocabulary with no free text', () => {
    expect(DOT_MESSAGE_REASONS).toContain('run_not_started')
    expect(DOT_MESSAGE_REASONS).toContain('dialog_open')
    expect(DOT_MESSAGE_REASONS).toContain('other')
    for (const reason of DOT_MESSAGE_REASONS) {
      expect(reason).toMatch(/^[a-z_]+$/)
    }
    expect(
      DotMessageResultSchema.safeParse(result({ outcome: 'refused', reason: 'the user said no' }))
        .success
    ).toBe(false)
  })

  it('never carries the message text, a run id or a delivery detail back to dot', () => {
    for (const field of ['text', 'runId', 'terminalHandle', 'deliveredAt']) {
      expect(DotMessageResultSchema.safeParse(result({ [field]: 'x' })).success, field).toBe(false)
    }
  })
})
